/**
 * Order Prisma Utilities
 * Helper functions for order database operations
 */

import { prisma } from "@/prisma/client";
import { MongoClient } from "mongodb";
import { createStripeRefund } from "@/lib/stripe";
import { orderCancelShouldRefundPayment } from "@/lib/orders/cancel-payment";
import type { Prisma } from "@prisma/client";
import type { CreateOrderInput } from "@/types/order";
import { invalidateCache, cacheKeys } from "@/lib/cache";
import { decrementStockAllocations } from "@/lib/products/decrement-stock-allocations";
import { fulfillPendingOrderLines, releasePendingOrderLines, reservePendingOrderLines } from "@/lib/products/order-stock-reservation";
import { getOrderLineCatalogAvailable } from "@/lib/orders/order-line-stock-validation";
import { productRequiresWarehousePick, resolveWarehouseName, validateWarehousePick, syncRestoreConfirmedOrderAllocations, syncFulfillReactivatedOrderAllocations } from "@/lib/products/stock-allocation-order-sync";
import { logger } from "@/lib/logger";

const CASH_REFUND_SOURCE = "refund";

async function recordCashRefund(params: { orderId: string; userId: string; amount: number; paymentMethod?: string | null }) {
  if (!Number.isFinite(params.amount) || params.amount <= 0) throw new Error("Invalid refund amount");
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  try {
    const collection = client.db().collection("CashMovement");
    const existing = await collection.findOne({ userId: params.userId, orderId: params.orderId, source: CASH_REFUND_SOURCE, status: { $ne: "voided" } });
    if (existing) return existing;
    const movement = { type: "expense", source: CASH_REFUND_SOURCE, orderId: params.orderId, amount: params.amount, paymentMethod: params.paymentMethod === "cash" || params.paymentMethod === "card" || params.paymentMethod === "transfer" || params.paymentMethod === "other" ? params.paymentMethod : "other", userId: params.userId, createdBy: params.userId, description: "Reembolso de venta", status: "active", createdAt: new Date() };
    const result = await collection.insertOne(movement);
    return { ...movement, _id: result.insertedId };
  } finally { await client.close(); }
}

export async function generateOrderNumber(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear(); const month = String(now.getMonth() + 1).padStart(2, "0"); const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0"); const minutes = String(now.getMinutes()).padStart(2, "0"); const seconds = String(now.getSeconds()).padStart(2, "0");
  const todayStart = new Date(year, now.getMonth(), now.getDate()); const todayEnd = new Date(year, now.getMonth(), now.getDate() + 1);
  const todayOrders = await prisma.order.count({ where: { createdAt: { gte: todayStart, lt: todayEnd } } });
  return `ORD-${year}-${month}${day}-${hours}${minutes}${seconds}-${String(todayOrders + 1).padStart(4, "0")}`;
}

export type CreateOrderParty = { storeOwnerUserId: string; createdByUserId: string; clientId: string | null };

export async function createOrder(data: CreateOrderInput, party: CreateOrderParty) {
  const orderNumber = await generateOrderNumber(); let subtotal = 0;
  const orderItemsData = [];
  const productsToReserve: { id: string; qty: number; warehouseId: string | null }[] = [];
  for (const item of data.items) {
    const product = await prisma.product.findUnique({ where: { id: item.productId } });
    if (!product || product.deletedAt != null) throw new Error(`Product not found: ${item.productId}`);
    const price = Number(product.price); const purchasePrice = Math.max(0, Number(product.purchasePrice ?? 0)); const lineSubtotal = price * item.quantity; subtotal += lineSubtotal;
    const ownerUserId = product.userId; const needsPick = await productRequiresWarehousePick(item.productId, ownerUserId);
    const productReserved = Number(product.reservedQuantity ?? 0); const productQty = Number(product.quantity);
    let availableStock: number;
    if (needsPick) {
      const allocationRows = await prisma.stockAllocation.findMany({ where: { productId: item.productId }, select: { reservedQuantity: true } });
      availableStock = getOrderLineCatalogAvailable(productQty, productReserved, allocationRows.map((row) => ({ reservedQuantity: Number(row.reservedQuantity ?? 0) })));
    } else availableStock = productQty - productReserved;
    if (availableStock < item.quantity) throw new Error(`Insufficient stock for product ${product.name}. Available: ${availableStock}, Requested: ${item.quantity}`);
    let warehouseId: string | null = item.warehouseId ?? null; let warehouseName: string | null = null;
    if (needsPick && warehouseId) {
      await validateWarehousePick(item.productId, warehouseId, item.quantity);
      warehouseName = await resolveWarehouseName(warehouseId, ownerUserId);
      if (!warehouseName) throw new Error(`Warehouse not found or unauthorized: ${warehouseId}`);
    } else warehouseId = null;
    orderItemsData.push({ productId: item.productId, productName: product.name, sku: product.sku, quantity: item.quantity, price, purchasePrice, subtotal: lineSubtotal, warehouseId, warehouseName });
    productsToReserve.push({ id: item.productId, qty: item.quantity, warehouseId });
  }
  const tax = data.tax || 0; const shipping = data.shipping || 0; const discount = data.discount || 0; const total = subtotal + tax + shipping - discount;
  const order = await prisma.order.create({ data: { orderNumber, userId: party.storeOwnerUserId, clientId: party.clientId, status: "pending", paymentStatus: "unpaid", subtotal, tax: tax > 0 ? tax : null, shipping: shipping > 0 ? shipping : null, discount: discount > 0 ? discount : null, total, shippingAddress: data.shippingAddress ? (JSON.parse(JSON.stringify(data.shippingAddress)) as Prisma.InputJsonValue) : null, billingAddress: data.billingAddress ? (JSON.parse(JSON.stringify(data.billingAddress)) as Prisma.InputJsonValue) : null, notes: data.notes || null, createdBy: party.createdByUserId, items: { create: orderItemsData } }, include: { items: true } });
  try {
    await reservePendingOrderLines(productsToReserve.map((p) => ({ productId: p.id, quantity: p.qty, warehouseId: p.warehouseId })));
  } catch (reservationError) {
    try { await prisma.order.delete({ where: { id: order.id } }); } catch (cleanupError) { logger.error("Failed to remove order after reservation failure", { orderId: order.id, orderNumber: order.orderNumber, error: cleanupError }); }
    throw reservationError;
  }
  await Promise.all([invalidateCache(cacheKeys.products.pattern), invalidateCache(cacheKeys.stockAllocation.pattern)]).catch((error) => console.error("Failed to invalidate product cache after order creation:", error));
  return order;
}

export async function getOrdersByUser(userId: string) {
  return prisma.order.findMany({ where: { userId, OR: [{ clientId: null }, { clientId: userId }] }, include: { items: { include: { product: { select: { id: true, name: true, sku: true, price: true } } } } }, orderBy: { createdAt: "desc" } });
}

export async function getOrderById(orderId: string, userId: string) {
  return prisma.order.findFirst({ where: { id: orderId, userId }, include: { items: { include: { product: { select: { id: true, name: true, sku: true, price: true, userId: true, categoryId: true, supplierId: true, imageUrl: true } } } } } });
}

export async function getOrdersByClientId(clientId: string) {
  return prisma.order.findMany({ where: { clientId }, include: { items: { include: { product: { select: { id: true, name: true, sku: true, price: true, userId: true } } } } }, orderBy: { createdAt: "desc" } });
}

export async function getOrdersContainingSupplierProducts(supplierId: string) {
  return prisma.order.findMany({ where: { items: { some: { product: { supplierId } } } }, include: { items: { include: { product: { select: { id: true, name: true, sku: true, price: true, userId: true, categoryId: true, supplierId: true, imageUrl: true } } } } }, orderBy: { createdAt: "desc" } });
}

export async function getOrdersContainingProductOwnerProducts(productOwnerUserId: string) {
  return prisma.order.findMany({ where: { items: { some: { product: { userId: productOwnerUserId } } } }, include: { items: { include: { product: { select: { id: true, name: true, sku: true, price: true, userId: true, categoryId: true, supplierId: true, imageUrl: true } } } } }, orderBy: { createdAt: "desc" } });
}

export { getOrderByIdForAdmin, getOrderByIdForProductOwner, getOrderByIdForSupplier, getOrderByIdForClient, updateOrder, cancelOrder } from "@/prisma/order-lifecycle";
