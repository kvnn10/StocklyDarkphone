/**
 * Order Detail API Route Handler
 * App Router route handler for individual order operations (GET, PUT, DELETE)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import { getOrderById, getOrderByIdForAdmin, updateOrder, cancelOrder } from "@/prisma/order";
import { prisma } from "@/prisma/client";
import { updateOrderSchema } from "@/lib/validations";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { sendOrderStatusUpdate } from "@/lib/email/notifications";
import { createOrderNotification } from "@/lib/notifications/in-app";
import { createAuditLog } from "@/prisma/audit-log";
import { getOrderDetailForPage } from "@/lib/server/order-detail-data";
import { invalidateOnOrderChange } from "@/lib/cache";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const transformedOrder = await getOrderDetailForPage({ id: session.id, role: session.role }, id);
    if (!transformedOrder) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    return NextResponse.json(transformedOrder);
  } catch (error) {
    logger.error("Error fetching order:", error);
    return NextResponse.json({ error: "Failed to fetch order" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const userId = session.id;
    const body = await request.json();
    const validationResult = updateOrderSchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn("Invalid order update data", { errors: validationResult.error.errors });
      return NextResponse.json({ error: "Invalid request body", details: validationResult.error.errors }, { status: 400 });
    }

    const updateData = validationResult.data;
    const isAdmin = session.role === "admin";

    // Payment status must only be changed by recording a real SalePayment.
    // This prevents generic order edits from creating accounting state without a payment record.
    if (updateData.paymentStatus !== undefined) {
      return NextResponse.json({ error: "Payment status can only be changed through the sale payment flow" }, { status: 409 });
    }
    if (!isAdmin && updateData.status === "cancelled") {
      return NextResponse.json({ error: "Only administrators can cancel orders" }, { status: 403 });
    }

    let existingOrder: Awaited<ReturnType<typeof getOrderById>> | null;
    if (isAdmin) existingOrder = await getOrderByIdForAdmin(id);
    else {
      existingOrder = await getOrderById(id, userId);
      if (!existingOrder) {
        const { getOrderByIdForProductOwner } = await import("@/prisma/order");
        existingOrder = await getOrderByIdForProductOwner(id, userId);
      }
    }
    if (!existingOrder) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const updatePayload: Record<string, unknown> = {};
    if (updateData.status) updatePayload.status = updateData.status;
    if (updateData.shippingAddress) updatePayload.shippingAddress = updateData.shippingAddress as Record<string, unknown>;
    if (updateData.billingAddress) updatePayload.billingAddress = updateData.billingAddress as Record<string, unknown>;
    if (updateData.trackingNumber) updatePayload.trackingNumber = updateData.trackingNumber;
    if (updateData.trackingCarrier) updatePayload.trackingCarrier = updateData.trackingCarrier;
    if (updateData.trackingUrl && updateData.trackingUrl !== "") updatePayload.trackingUrl = updateData.trackingUrl;
    if (updateData.estimatedDelivery && updateData.estimatedDelivery !== "") updatePayload.estimatedDelivery = new Date(updateData.estimatedDelivery);
    if (updateData.shippedAt && updateData.shippedAt !== "") updatePayload.shippedAt = new Date(updateData.shippedAt);
    if (updateData.deliveredAt && updateData.deliveredAt !== "") updatePayload.deliveredAt = new Date(updateData.deliveredAt);
    if (updateData.cancelledAt && updateData.cancelledAt !== "") updatePayload.cancelledAt = new Date(updateData.cancelledAt);
    if (updateData.notes !== undefined) updatePayload.notes = updateData.notes;

    const order = await updateOrder(id, updatePayload, isAdmin ? existingOrder.userId : userId);
    const auditDetails: Record<string, unknown> = {};
    if (existingOrder.orderNumber) auditDetails.orderNumber = existingOrder.orderNumber;
    if (updateData.status && existingOrder.status !== updateData.status) {
      auditDetails.statusFrom = existingOrder.status;
      auditDetails.statusTo = updateData.status;
    }
    const newTracking = order.trackingNumber ?? updateData.trackingNumber;
    const newCarrier = order.trackingCarrier;
    if (newTracking) {
      auditDetails.trackingNumber = newTracking;
      if (newCarrier) auditDetails.trackingCarrier = newCarrier;
    }
    if (order.labelUrl) auditDetails.labelSource = "Generated via Shippo";
    createAuditLog({ userId, action: "update", entityType: "order", entityId: id, details: Object.keys(auditDetails).length > 0 ? auditDetails : undefined }).catch(() => {});
    await invalidateOnOrderChange();

    const statusChanged = updateData.status && updateData.status !== existingOrder.status;
    const isNowShipped = statusChanged && updateData.status === "shipped";
    const trackingAdded = (updateData.trackingNumber || updateData.trackingUrl) && !existingOrder.trackingNumber && !existingOrder.trackingUrl;
    const trackingChanged = (updateData.trackingNumber && updateData.trackingNumber !== existingOrder.trackingNumber) || (updateData.trackingUrl && updateData.trackingUrl !== existingOrder.trackingUrl && updateData.trackingUrl !== "");
    const notesChanged = updateData.notes !== undefined && updateData.notes !== existingOrder.notes;
    const otherFieldsChanged = updateData.estimatedDelivery || updateData.shippedAt || updateData.deliveredAt;

    if (statusChanged) createOrderNotification("order_status_update", order.orderNumber, `Order ${order.orderNumber} status updated from ${existingOrder.status} to ${updateData.status}`, userId, order.id).catch((error) => logger.error("Failed to create in-app notification for order status update:", error));
    if (!statusChanged && (trackingChanged || notesChanged || otherFieldsChanged)) {
      const changeMessages: string[] = [];
      if (trackingChanged) changeMessages.push("tracking information updated");
      if (notesChanged) changeMessages.push("notes updated");
      if (changeMessages.length > 0) createOrderNotification("order_status_update", order.orderNumber, `Order ${order.orderNumber} edited: ${changeMessages.join(", ")}`, userId, order.id).catch((error) => logger.error("Failed to create in-app notification for order edit:", error));
    }
    if (isNowShipped || (updateData.status === "shipped" && trackingAdded)) {
      const trackingInfo = updateData.trackingNumber || existingOrder.trackingNumber;
      const message = trackingInfo ? `Order ${order.orderNumber} has been shipped. Tracking: ${trackingInfo}` : `Order ${order.orderNumber} has been shipped.`;
      createOrderNotification("shipping_notification", order.orderNumber, message, userId, order.id).catch((error) => logger.error("Failed to create in-app notification for shipping:", error));
    }
    if (statusChanged && existingOrder.shippingAddress && typeof existingOrder.shippingAddress === "object") {
      const shippingAddr = existingOrder.shippingAddress as { email?: string; name?: string };
      if (shippingAddr.email) sendOrderStatusUpdate({ orderNumber: order.orderNumber, clientName: shippingAddr.name || "Customer", clientEmail: shippingAddr.email, previousStatus: existingOrder.status, newStatus: updateData.status ?? order.status, orderUrl: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"}/orders/${order.id}`, estimatedDelivery: order.estimatedDelivery?.toISOString() }, shippingAddr.email, shippingAddr.name).catch((error) => logger.error("Failed to send order status update email:", error));
    }

    const orderWithItems = order as typeof order & { items: Array<{ id: string; orderId: string; productId: string; productName: string; sku: string | null; quantity: number; price: number; subtotal: number; createdAt: Date; product?: { categoryId?: string | null; supplierId?: string | null; imageUrl?: string | null } }> };
    const transformedOrder = {
      id: orderWithItems.id, orderNumber: orderWithItems.orderNumber, userId: orderWithItems.userId, clientId: orderWithItems.clientId, status: orderWithItems.status, paymentStatus: orderWithItems.paymentStatus, subtotal: orderWithItems.subtotal, tax: orderWithItems.tax, shipping: orderWithItems.shipping, discount: orderWithItems.discount, total: orderWithItems.total, shippingAddress: orderWithItems.shippingAddress, billingAddress: orderWithItems.billingAddress, notes: orderWithItems.notes, trackingNumber: orderWithItems.trackingNumber, trackingCarrier: orderWithItems.trackingCarrier ?? null, trackingUrl: orderWithItems.trackingUrl, labelUrl: orderWithItems.labelUrl ?? null, estimatedDelivery: orderWithItems.estimatedDelivery?.toISOString() || null, shippedAt: orderWithItems.shippedAt?.toISOString() || null, deliveredAt: orderWithItems.deliveredAt?.toISOString() || null, cancelledAt: orderWithItems.cancelledAt?.toISOString() || null, createdAt: orderWithItems.createdAt.toISOString(), updatedAt: orderWithItems.updatedAt?.toISOString() || null, createdBy: orderWithItems.createdBy, updatedBy: orderWithItems.updatedBy,
      items: (orderWithItems.items || []).map((item) => ({ id: item.id, orderId: item.orderId, productId: item.productId, productName: item.productName, sku: item.sku, quantity: item.quantity, price: item.price, subtotal: item.subtotal, createdAt: item.createdAt.toISOString(), categoryId: item.product?.categoryId ?? null, supplierId: item.product?.supplierId ?? null, imageUrl: item.product?.imageUrl ?? null })),
    };
    return NextResponse.json(transformedOrder);
  } catch (error) {
    logger.error("Error updating order:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update order" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role !== "admin") return NextResponse.json({ error: "Only administrators can cancel orders" }, { status: 403 });

    const { id } = await params;
    const userId = session.id;
    const existingOrder = await getOrderByIdForAdmin(id);
    if (!existingOrder) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const order = await cancelOrder(id, existingOrder.userId);
    createAuditLog({ userId, action: "delete", entityType: "order", entityId: id, details: { orderNumber: existingOrder.orderNumber, summary: "Order cancelled" } }).catch(() => {});
    await invalidateOnOrderChange();
    createOrderNotification("order_status_update", order.orderNumber, `Order ${order.orderNumber} has been cancelled`, userId, order.id).catch((error) => logger.error("Failed to create in-app notification for order cancellation:", error));

    const linkedInvoice = await prisma.invoice.findFirst({ where: { orderId: id }, select: { id: true, invoiceNumber: true, status: true, amountDue: true, amountPaid: true, total: true, cancelledAt: true, paidAt: true, dueDate: true, sentAt: true, createdAt: true, updatedAt: true } });
    const cancelledAtIso = order.cancelledAt?.toISOString() || null;
    const transformedOrder = {
      id: order.id, orderNumber: order.orderNumber, userId: order.userId, clientId: order.clientId, status: order.status, paymentStatus: order.paymentStatus, subtotal: order.subtotal, tax: order.tax, shipping: order.shipping, discount: order.discount, total: order.total, shippingAddress: order.shippingAddress, billingAddress: order.billingAddress, notes: order.notes, trackingNumber: order.trackingNumber, trackingCarrier: order.trackingCarrier ?? null, trackingUrl: order.trackingUrl, labelUrl: order.labelUrl ?? null, estimatedDelivery: order.estimatedDelivery?.toISOString() || null, shippedAt: order.shippedAt?.toISOString() || null, deliveredAt: order.deliveredAt?.toISOString() || null, cancelledAt: cancelledAtIso, statusAt: cancelledAtIso, createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt?.toISOString() || null, createdBy: order.createdBy, updatedBy: order.updatedBy,
      invoiceForOrder: linkedInvoice ? { id: linkedInvoice.id, invoiceNumber: linkedInvoice.invoiceNumber, status: linkedInvoice.status, amountDue: linkedInvoice.amountDue, amountPaid: linkedInvoice.amountPaid, total: linkedInvoice.total, cancelledAt: linkedInvoice.cancelledAt?.toISOString() || null, paidAt: linkedInvoice.paidAt?.toISOString() || null, dueDate: linkedInvoice.dueDate?.toISOString() || undefined, sentAt: linkedInvoice.sentAt?.toISOString() || null, createdAt: linkedInvoice.createdAt.toISOString(), updatedAt: linkedInvoice.updatedAt?.toISOString() || null } : null,
      items: (order.items || []).map((item: { id: string; orderId: string; productId: string; productName: string; sku: string | null; quantity: number; price: number; subtotal: number; createdAt: Date }) => ({ id: item.id, orderId: item.orderId, productId: item.productId, productName: item.productName, sku: item.sku, quantity: item.quantity, price: item.price, subtotal: item.subtotal, createdAt: item.createdAt.toISOString() })),
    };
    return NextResponse.json(transformedOrder);
  } catch (error) {
    logger.error("Error cancelling order:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to cancel order" }, { status: 500 });
  }
}
