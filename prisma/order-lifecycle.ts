import { prisma } from "@/prisma/client";
import type { Prisma } from "@prisma/client";
import type { UpdateOrderInput } from "@/types/order";
import { createStripeRefund } from "@/lib/stripe";
import { orderCancelShouldRefundPayment } from "@/lib/orders/cancel-payment";
import { invalidateCache, cacheKeys } from "@/lib/cache";
import { decrementStockAllocations } from "@/lib/products/decrement-stock-allocations";
import { fulfillPendingOrderLines, releasePendingOrderLines } from "@/lib/products/order-stock-reservation";
import { syncRestoreConfirmedOrderAllocations, syncFulfillReactivatedOrderAllocations } from "@/lib/products/stock-allocation-order-sync";
import { logger } from "@/lib/logger";
import { writeAuditLog } from "@/lib/audit/log";
import { MongoClient } from "mongodb";

const detailProductSelect = { id: true, name: true, sku: true, price: true, userId: true, categoryId: true, supplierId: true, imageUrl: true } as const;
const CASH_SALE_SOURCE = "sale";
const CASH_REFUND_SOURCE = "refund";
const CASH_METHODS = new Set(["cash", "card", "transfer", "other"]);

export async function getOrderByIdForAdmin(orderId: string) {
  return prisma.order.findFirst({ where: { id: orderId }, include: { items: { include: { product: { select: detailProductSelect } } } } });
}

export async function getOrderByIdForProductOwner(orderId: string, productOwnerUserId: string) {
  const order = await getOrderByIdForAdmin(orderId);
  if (!order) return null;
  return order.items.some((item) => item.product.userId === productOwnerUserId) ? order : null;
}

export async function getOrderByIdForSupplier(orderId: string, supplierId: string) {
  const order = await getOrderByIdForAdmin(orderId);
  if (!order) return null;
  return order.items.some((item) => item.product.supplierId === supplierId) ? order : null;
}

const clientInclude = { items: { include: { product: { select: detailProductSelect } } } } as const;
export async function getOrderByIdForClient(orderId: string, clientId: string) {
  const own = await prisma.order.findFirst({ where: { id: orderId, clientId }, include: clientInclude });
  if (own) return own;
  return prisma.order.findFirst({ where: { id: orderId, items: { some: {} } }, include: clientInclude });
}

async function recordCashSale(orderId: string, userId: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid sale amount");
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  try {
    const collection = client.db().collection("CashMovement");
    const existing = await collection.findOne({ userId, orderId, source: CASH_SALE_SOURCE, status: { $ne: "voided" } });
    if (existing) return existing;
    const movement = {
      type: "income",
      source: CASH_SALE_SOURCE,
      orderId,
      amount,
      paymentMethod: "other",
      userId,
      createdBy: userId,
      description: "Venta",
      status: "active",
      createdAt: new Date(),
    };
    const result = await collection.insertOne(movement);
    return { ...movement, _id: result.insertedId };
  } finally { await client.close(); }
}

async function recordCashRefund(orderId: string, userId: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid refund amount");
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  try {
    const collection = client.db().collection("CashMovement");
    const existing = await collection.findOne({ userId, orderId, source: CASH_REFUND_SOURCE, status: { $ne: "voided" } });
    if (existing) return existing;
    const sale = await collection.findOne({ userId, orderId, source: CASH_SALE_SOURCE, status: { $ne: "voided" } });
    const paymentMethod = typeof sale?.paymentMethod === "string" && CASH_METHODS.has(sale.paymentMethod) ? sale.paymentMethod : "other";
    const movement = {
      type: "expense",
      source: CASH_REFUND_SOURCE,
      orderId,
      amount,
      paymentMethod,
      userId,
      createdBy: userId,
      description: "Reembolso de venta",
      status: "active",
      createdAt: new Date(),
    };
    const result = await collection.insertOne(movement);
    return { ...movement, _id: result.insertedId };
  } finally { await client.close(); }
}

export async function updateOrder(orderId: string, data: UpdateOrderInput, userId: string) {
  const existing = await prisma.order.findFirst({ where: { id: orderId, userId } });
  if (!existing) throw new Error("Order not found or unauthorized");
  const items = await prisma.orderItem.findMany({ where: { orderId } });
  const updateData: Prisma.OrderUpdateInput = { updatedAt: new Date(), updatedBy: userId };
  if (data.status) updateData.status = data.status;
  if (data.paymentStatus) updateData.paymentStatus = data.paymentStatus;
  if (data.shippingAddress) updateData.shippingAddress = JSON.parse(JSON.stringify(data.shippingAddress)) as Prisma.InputJsonValue;
  if (data.billingAddress) updateData.billingAddress = JSON.parse(JSON.stringify(data.billingAddress)) as Prisma.InputJsonValue;
  if (data.trackingNumber) updateData.trackingNumber = data.trackingNumber;
  if (data.trackingCarrier) updateData.trackingCarrier = data.trackingCarrier;
  if (data.trackingUrl) updateData.trackingUrl = data.trackingUrl;
  if (data.estimatedDelivery) updateData.estimatedDelivery = data.estimatedDelivery;
  if (data.shippedAt) updateData.shippedAt = data.shippedAt;
  if (data.deliveredAt) updateData.deliveredAt = data.deliveredAt;
  if (data.cancelledAt) updateData.cancelledAt = data.cancelledAt;
  if (data.notes !== undefined) updateData.notes = data.notes;

  const previousStatus = existing.status;
  const previousPaid = existing.paymentStatus === "paid";
  const nextStatus = data.status ?? previousStatus;
  const nextPaid = (data.paymentStatus ?? existing.paymentStatus) === "paid";
  const wasFulfilled = ["confirmed", "processing", "shipped", "delivered"].includes(previousStatus) || previousPaid;
  const isFulfilled = ["confirmed", "processing", "shipped", "delivered"].includes(nextStatus) || nextPaid;
  const cancelling = nextStatus === "cancelled" && previousStatus !== "cancelled";
  const confirming = isFulfilled && !wasFulfilled && previousStatus === "pending";
  const reactivating = previousStatus === "cancelled" && isFulfilled;
  const paymentCaptured = nextPaid && !previousPaid;

  if (confirming) await fulfillPendingOrderLines(items.map((i) => ({ productId: i.productId, quantity: i.quantity, warehouseId: i.warehouseId ?? null })));
  if (cancelling && !wasFulfilled) await releasePendingOrderLines(items.map((i) => ({ productId: i.productId, quantity: i.quantity, warehouseId: i.warehouseId ?? null })));
  if (cancelling && wasFulfilled) {
    for (const item of items) await prisma.product.update({ where: { id: item.productId }, data: { quantity: { increment: item.quantity } } });
    await syncRestoreConfirmedOrderAllocations(items.map((i) => ({ productId: i.productId, quantity: i.quantity, warehouseId: i.warehouseId ?? null })));
  }
  if (reactivating) {
    for (const item of items) await prisma.product.update({ where: { id: item.productId }, data: { quantity: { decrement: item.quantity } } });
    await syncFulfillReactivatedOrderAllocations(items.map((i) => ({ productId: i.productId, quantity: i.quantity, warehouseId: i.warehouseId ?? null })));
    await decrementStockAllocations(items.filter((i) => !i.warehouseId).map((i) => ({ productId: i.productId, quantity: i.quantity })));
  }

  const updated = await prisma.order.update({ where: { id: orderId }, data: updateData, include: { items: { include: { product: { select: detailProductSelect } } } } });
  if (paymentCaptured) {
    await recordCashSale(orderId, userId, Number(updated.total));
    await writeAuditLog({ userId, action: "PAYMENT_CAPTURED", entityType: "Order", entityId: orderId, details: { orderNumber: updated.orderNumber, amount: Number(updated.total) } });
  }
  if (confirming) await writeAuditLog({ userId, action: "ORDER_CONFIRMED", entityType: "Order", entityId: orderId, details: { orderNumber: updated.orderNumber } });
  if (reactivating) await writeAuditLog({ userId, action: "ORDER_REACTIVATED", entityType: "Order", entityId: orderId, details: { orderNumber: updated.orderNumber } });
  if (cancelling) await writeAuditLog({ userId, action: "ORDER_CANCELLED", entityType: "Order", entityId: orderId, details: { orderNumber: updated.orderNumber, previousStatus } });
  if (cancelling || confirming || reactivating) await Promise.all([invalidateCache(cacheKeys.products.pattern), invalidateCache(cacheKeys.stockAllocation.pattern)]);
  return updated;
}

export async function cancelOrder(orderId: string, userId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, include: { items: true } });
  if (!order) throw new Error("Order not found or unauthorized");
  if (order.status === "cancelled") return order;

  const shouldRefund = orderCancelShouldRefundPayment(order.paymentStatus, order.status);
  const invoice = await prisma.invoice.findUnique({ where: { orderId }, select: { id: true, status: true, amountPaid: true, stripePaymentIntentId: true } });
  let refundConfirmed = false;
  if (shouldRefund) {
    const paymentIntentId = order.stripePaymentIntentId ?? invoice?.stripePaymentIntentId;
    if (!paymentIntentId) throw new Error("No se puede cancelar una venta pagada o parcialmente pagada sin un PaymentIntent de Stripe para procesar el reembolso.");
    await createStripeRefund(paymentIntentId, "requested_by_customer");
    refundConfirmed = true;
  }

  const wasFulfilled = ["confirmed", "processing", "shipped", "delivered"].includes(order.status) || order.paymentStatus === "paid";
  const allocationItems = order.items.map((i) => ({ productId: i.productId, quantity: i.quantity, warehouseId: i.warehouseId ?? null }));
  if (wasFulfilled) {
    for (const item of order.items) await prisma.product.update({ where: { id: item.productId }, data: { quantity: { increment: item.quantity } } });
    await syncRestoreConfirmedOrderAllocations(allocationItems);
  } else {
    await releasePendingOrderLines(allocationItems);
  }

  const cancelled = await prisma.order.update({ where: { id: orderId }, data: { status: "cancelled", paymentStatus: refundConfirmed ? "refunded" : order.paymentStatus, cancelledAt: new Date(), updatedAt: new Date(), updatedBy: userId }, include: { items: true } });
  if (refundConfirmed) {
    await recordCashRefund(orderId, userId, Number(invoice?.amountPaid ?? order.total));
    await writeAuditLog({ userId, action: "ORDER_REFUNDED", entityType: "Order", entityId: orderId, details: { orderNumber: cancelled.orderNumber, amount: Number(invoice?.amountPaid ?? order.total) } });
  }
  if (invoice && invoice.status !== "cancelled") await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "cancelled", cancelledAt: new Date(), amountDue: 0, updatedAt: new Date() } });
  await writeAuditLog({ userId, action: "ORDER_CANCELLED", entityType: "Order", entityId: orderId, details: { orderNumber: cancelled.orderNumber, refunded: refundConfirmed } });
  await Promise.all([invalidateCache(cacheKeys.products.pattern), invalidateCache(cacheKeys.stockAllocation.pattern)]);
  logger.info("Order cancelled", { orderId, userId });
  return cancelled;
}