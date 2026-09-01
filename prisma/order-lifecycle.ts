import { prisma } from "@/prisma/client";
import type { Prisma } from "@prisma/client";
import type { UpdateOrderInput } from "@/types/order";
import { createStripeRefund } from "@/lib/stripe";
import { orderCancelShouldRefundPayment } from "@/lib/orders/cancel-payment";
import { invalidateCache, cacheKeys } from "@/lib/cache";
import { fulfillPendingOrderLines, releasePendingOrderLines } from "@/lib/products/order-stock-reservation";
import { planAllocationDecrements } from "@/lib/products/plan-allocation-decrements";
import { logger } from "@/lib/logger";
import { writeAuditLog } from "@/lib/audit/log";

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
  return prisma.order.findFirst({ where: { id: orderId, OR: [{ clientId }, { clientId: null, userId: clientId }] }, include: clientInclude });
}

async function recordCashSale(orderId: string, userId: string, amount: number, tx?: Prisma.TransactionClient) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid sale amount");
  const db = tx ?? prisma;
  const existing = await db.cashMovement.findFirst({
    where: { userId, orderId, source: CASH_SALE_SOURCE, status: { not: "voided" } },
  });
  if (existing) return existing;

  return db.cashMovement.create({
    data: {
      type: "income",
      source: CASH_SALE_SOURCE,
      orderId,
      amount,
      paymentMethod: "other",
      userId,
      createdBy: userId,
      description: "Venta",
      status: "active",
    },
  });
}

async function recordCashRefund(orderId: string, userId: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid refund amount");
  const existing = await prisma.cashMovement.findFirst({
    where: { userId, orderId, source: CASH_REFUND_SOURCE, status: { not: "voided" } },
  });
  if (existing) return existing;

  const sale = await prisma.cashMovement.findFirst({
    where: { userId, orderId, source: CASH_SALE_SOURCE, status: { not: "voided" } },
    orderBy: { createdAt: "desc" },
  });
  const paymentMethod =
    typeof sale?.paymentMethod === "string" && CASH_METHODS.has(sale.paymentMethod)
      ? sale.paymentMethod
      : "other";

  return prisma.cashMovement.create({
    data: {
      type: "expense",
      source: CASH_REFUND_SOURCE,
      orderId,
      amount,
      paymentMethod,
      userId,
      createdBy: userId,
      description: "Reembolso de venta",
      status: "active",
    },
  });
}

type OrderItemStock = { productId: string; quantity: number; warehouseId?: string | null };

async function restoreFulfilledStock(tx: Prisma.TransactionClient, items: OrderItemStock[]) {
  for (const item of items) {
    const product = await tx.product.findUnique({ where: { id: item.productId }, select: { id: true, quantity: true } });
    if (!product) throw new Error(`Product ${item.productId} not found`);
    const productResult = await tx.product.updateMany({ where: { id: product.id, quantity: product.quantity }, data: { quantity: { increment: item.quantity }, updatedAt: new Date() } });
    if (productResult.count !== 1) throw new Error(`Stock changed while restoring product ${item.productId}; please retry.`);

    if (item.warehouseId) {
      const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: item.warehouseId } }, select: { id: true, quantity: true, reservedQuantity: true, userId: true } });
      if (!allocation) throw new Error(`No stock allocation for product ${item.productId} at warehouse ${item.warehouseId}`);
      const previousStock = allocation.quantity;
      const result = await tx.stockAllocation.updateMany({ where: { id: allocation.id, quantity: allocation.quantity }, data: { quantity: { increment: item.quantity }, updatedAt: new Date() } });
      if (result.count !== 1) throw new Error(`Warehouse stock changed while restoring product ${item.productId}; please retry.`);
      await tx.inventoryMovement.create({ data: { productId: item.productId, warehouseId: item.warehouseId, userId: allocation.userId, type: "entry", quantity: BigInt(item.quantity), previousStock, newStock: previousStock + BigInt(item.quantity), reason: "Reintegro por cancelación de pedido", referenceId: null, notes: null, createdAt: new Date() } });
    }
  }
}

async function releasePendingStock(tx: Prisma.TransactionClient, items: OrderItemStock[]) {
  for (const item of items) {
    if (item.warehouseId) {
      const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: item.warehouseId } }, select: { id: true, reservedQuantity: true } });
      if (!allocation || Number(allocation.reservedQuantity ?? 0) < item.quantity) throw new Error(`Cannot release ${item.quantity} reserved units for product ${item.productId}`);
      const result = await tx.stockAllocation.updateMany({ where: { id: allocation.id, reservedQuantity: allocation.reservedQuantity }, data: { reservedQuantity: { decrement: item.quantity }, updatedAt: new Date() } });
      if (result.count !== 1) throw new Error(`Warehouse reservation changed for product ${item.productId}; please retry.`);
    } else {
      const product = await tx.product.findUnique({ where: { id: item.productId }, select: { id: true, reservedQuantity: true } });
      if (!product || Number(product.reservedQuantity ?? 0) < item.quantity) throw new Error(`Cannot release ${item.quantity} reserved units for product ${item.productId}`);
      const result = await tx.product.updateMany({ where: { id: product.id, reservedQuantity: product.reservedQuantity }, data: { reservedQuantity: { decrement: item.quantity }, updatedAt: new Date() } });
      if (result.count !== 1) throw new Error(`Product reservation changed for product ${item.productId}; please retry.`);
    }
  }
}

async function consumeReactivatedStock(tx: Prisma.TransactionClient, items: OrderItemStock[]) {
  for (const item of items) {
    const product = await tx.product.findUnique({ where: { id: item.productId }, select: { id: true, quantity: true } });
    if (!product || Number(product.quantity) < item.quantity) throw new Error(`Insufficient stock to reactivate product ${item.productId}`);
    const productResult = await tx.product.updateMany({ where: { id: product.id, quantity: product.quantity }, data: { quantity: { decrement: item.quantity }, updatedAt: new Date() } });
    if (productResult.count !== 1) throw new Error(`Stock changed while reactivating product ${item.productId}; please retry.`);

    if (item.warehouseId) {
      const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: item.warehouseId } }, select: { id: true, quantity: true, reservedQuantity: true, userId: true } });
      if (!allocation || Number(allocation.quantity) < item.quantity) throw new Error(`Insufficient warehouse stock for product ${item.productId}`);
      const previousStock = allocation.quantity;
      const result = await tx.stockAllocation.updateMany({ where: { id: allocation.id, quantity: allocation.quantity }, data: { quantity: { decrement: item.quantity }, updatedAt: new Date() } });
      if (result.count !== 1) throw new Error(`Warehouse stock changed while reactivating product ${item.productId}; please retry.`);
      await tx.inventoryMovement.create({ data: { productId: item.productId, warehouseId: item.warehouseId, userId: allocation.userId, type: "exit", quantity: -BigInt(item.quantity), previousStock, newStock: previousStock - BigInt(item.quantity), reason: "Salida por pedido reactivado", referenceId: null, notes: null, createdAt: new Date() } });
    } else {
      const allocations = await tx.stockAllocation.findMany({ where: { productId: item.productId }, select: { id: true, quantity: true, reservedQuantity: true, warehouseId: true, userId: true } });
      const steps = planAllocationDecrements(allocations.map((a) => ({ id: a.id, quantity: Number(a.quantity), reservedQuantity: Number(a.reservedQuantity), warehouseId: a.warehouseId })), item.quantity);
      if (steps.reduce((sum, step) => sum + step.deduct, 0) !== item.quantity) throw new Error(`Insufficient allocated warehouse stock for product ${item.productId}`);
      for (const step of steps) {
        const allocation = allocations.find((a) => a.id === step.id);
        if (!allocation) throw new Error(`Allocation not found for product ${item.productId}`);
        const previousStock = allocation.quantity;
        const result = await tx.stockAllocation.updateMany({ where: { id: allocation.id, quantity: allocation.quantity, reservedQuantity: allocation.reservedQuantity }, data: { quantity: { decrement: step.deduct }, updatedAt: new Date() } });
        if (result.count !== 1) throw new Error(`Warehouse stock changed while reactivating product ${item.productId}; please retry.`);
        await tx.inventoryMovement.create({ data: { productId: item.productId, warehouseId: allocation.warehouseId, userId: allocation.userId, type: "exit", quantity: -BigInt(step.deduct), previousStock, newStock: previousStock - BigInt(step.deduct), reason: "Salida por pedido reactivado", referenceId: null, notes: "Asignación automática de bodega", createdAt: new Date() } });
      }
    }
  }
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
  const stockLines = items.map((i) => ({ productId: i.productId, quantity: i.quantity, warehouseId: i.warehouseId ?? null }));

  let updated;
  if (confirming || cancelling || reactivating || paymentCaptured) {
    updated = await prisma.$transaction(async (tx) => {
      if (confirming) await fulfillPendingOrderLines(stockLines, tx);
      if (cancelling && !wasFulfilled) await releasePendingStock(tx, items);
      if (cancelling && wasFulfilled) await restoreFulfilledStock(tx, items);
      if (reactivating) await consumeReactivatedStock(tx, items);
      const result = await tx.order.update({ where: { id: orderId }, data: updateData, include: { items: { include: { product: { select: detailProductSelect } } } } });
      if (paymentCaptured) await recordCashSale(orderId, userId, Number(result.total), tx);
      return result;
    });
  } else {
    updated = await prisma.order.update({ where: { id: orderId }, data: updateData, include: { items: { include: { product: { select: detailProductSelect } } } } });
  }

  if (paymentCaptured) {
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

  const cancelled = await prisma.$transaction(async (tx) => {
    if (wasFulfilled) await restoreFulfilledStock(tx, allocationItems);
    else await releasePendingStock(tx, allocationItems);
    return tx.order.update({ where: { id: orderId }, data: { status: "cancelled", paymentStatus: refundConfirmed ? "refunded" : order.paymentStatus, cancelledAt: new Date(), updatedAt: new Date(), updatedBy: userId }, include: { items: true } });
  });

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
