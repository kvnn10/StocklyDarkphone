/**
 * REQ-0068 — per-warehouse order picking sync between OrderItem and StockAllocation.
 * REQ-0102 reservation invariant: warehouse picks reserve only StockAllocation;
 * non-picked orders reserve only Product. Operations below use optimistic
 * compare-and-swap updates so concurrent requests cannot over-reserve or release
 * more units than are actually reserved.
 */

import { prisma } from "@/prisma/client";
import { getOrderLineWarehouseAvailable } from "@/lib/orders/order-line-stock-validation";

export type WarehousePickOption = { warehouseId: string; warehouseName: string; available: number };
export type OrderLineAllocationRef = { productId: string; warehouseId: string | null; quantity: number };

function assertPositiveQuantity(quantity: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error(`Invalid stock quantity: ${quantity}`);
  }
}

export async function getProductAllocationWarehouses(productId: string, ownerUserId: string): Promise<WarehousePickOption[]> {
  const allocations = await prisma.stockAllocation.findMany({
    where: { productId },
    select: { warehouseId: true, quantity: true, reservedQuantity: true },
  });
  if (!allocations.length) return [];
  const warehouseIds = [...new Set(allocations.map((a) => a.warehouseId))];
  const warehouses = await prisma.warehouse.findMany({ where: { id: { in: warehouseIds }, userId: ownerUserId }, select: { id: true, name: true } });
  const names = new Map(warehouses.map((w) => [w.id, w.name]));
  return allocations.flatMap((a) => {
    const name = names.get(a.warehouseId);
    if (!name) return [];
    const available = Number(a.quantity) - Number(a.reservedQuantity ?? 0);
    return available > 0 ? [{ warehouseId: a.warehouseId, warehouseName: name, available }] : [];
  }).sort((a, b) => b.available - a.available);
}

export async function productRequiresWarehousePick(productId: string, ownerUserId: string): Promise<boolean> {
  const allocations = await prisma.stockAllocation.findMany({ where: { productId }, select: { warehouseId: true } });
  if (!allocations.length) return false;
  return (await prisma.warehouse.count({ where: { id: { in: allocations.map((a) => a.warehouseId) }, userId: ownerUserId } })) > 0;
}

export async function resolveWarehouseName(warehouseId: string, ownerUserId: string): Promise<string | null> {
  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, userId: ownerUserId }, select: { name: true } });
  return warehouse?.name ?? null;
}

export async function validateWarehousePick(productId: string, warehouseId: string, quantity: number): Promise<void> {
  assertPositiveQuantity(quantity);
  const allocation = await prisma.stockAllocation.findUnique({ where: { productId_warehouseId: { productId, warehouseId } }, select: { quantity: true, reservedQuantity: true } });
  if (!allocation) throw new Error(`No stock allocation for product ${productId} at warehouse ${warehouseId}`);
  const maxQty = getOrderLineWarehouseAvailable(Number(allocation.quantity), Number(allocation.reservedQuantity ?? 0));
  if (quantity > maxQty) {
    const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId }, select: { name: true } });
    throw new Error(`Max ${maxQty} at ${warehouse?.name?.trim() || "warehouse"}`);
  }
}

/** Atomically reserve by compare-and-swap on the row values observed before the update. */
export async function reserveAllocationForOrderItem(productId: string, warehouseId: string, quantity: number): Promise<void> {
  assertPositiveQuantity(quantity);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const allocation = await prisma.stockAllocation.findUnique({ where: { productId_warehouseId: { productId, warehouseId } }, select: { id: true, quantity: true, reservedQuantity: true } });
    if (!allocation) throw new Error(`No stock allocation for product ${productId} at warehouse ${warehouseId}`);
    const available = Number(allocation.quantity) - Number(allocation.reservedQuantity ?? 0);
    if (available < quantity) throw new Error(`Insufficient available stock at warehouse ${warehouseId}`);
    const result = await prisma.stockAllocation.updateMany({
      where: { id: allocation.id, quantity: allocation.quantity, reservedQuantity: allocation.reservedQuantity },
      data: { reservedQuantity: { increment: quantity }, updatedAt: new Date() },
    });
    if (result.count === 1) return;
  }
  throw new Error("Stock changed while reserving; please retry the order.");
}

/** Atomically release only a reservation that is still present. */
export async function releaseAllocationReservation(productId: string, warehouseId: string, quantity: number): Promise<void> {
  assertPositiveQuantity(quantity);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const allocation = await prisma.stockAllocation.findUnique({ where: { productId_warehouseId: { productId, warehouseId } }, select: { id: true, reservedQuantity: true } });
    if (!allocation) throw new Error(`No stock allocation for product ${productId} at warehouse ${warehouseId}`);
    if (Number(allocation.reservedQuantity ?? 0) < quantity) throw new Error(`Cannot release ${quantity} reserved units for product ${productId}`);
    const result = await prisma.stockAllocation.updateMany({
      where: { id: allocation.id, reservedQuantity: allocation.reservedQuantity },
      data: { reservedQuantity: { decrement: quantity }, updatedAt: new Date() },
    });
    if (result.count === 1) return;
  }
  throw new Error("Stock changed while releasing reservation; please retry.");
}

/** Atomically consume stock; pending orders also release their reservation. */
export async function fulfillAllocationFromPick(productId: string, warehouseId: string, quantity: number, options?: { releaseReservation?: boolean }): Promise<void> {
  assertPositiveQuantity(quantity);
  const releaseReservation = options?.releaseReservation ?? true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const allocation = await prisma.stockAllocation.findUnique({ where: { productId_warehouseId: { productId, warehouseId } }, select: { id: true, quantity: true, reservedQuantity: true } });
    if (!allocation) throw new Error(`No stock allocation for product ${productId} at warehouse ${warehouseId}`);
    if (Number(allocation.quantity) < quantity) throw new Error(`Insufficient stock at warehouse ${warehouseId}`);
    if (releaseReservation && Number(allocation.reservedQuantity ?? 0) < quantity) throw new Error(`Insufficient reservation at warehouse ${warehouseId}`);
    const result = await prisma.stockAllocation.updateMany({
      where: { id: allocation.id, quantity: allocation.quantity, reservedQuantity: allocation.reservedQuantity },
      data: {
        quantity: { decrement: quantity },
        ...(releaseReservation ? { reservedQuantity: { decrement: quantity } } : {}),
        updatedAt: new Date(),
      },
    });
    if (result.count === 1) return;
  }
  throw new Error("Stock changed while fulfilling the order; please retry.");
}

export async function restoreAllocationOnCancelConfirmed(productId: string, warehouseId: string, quantity: number): Promise<void> {
  assertPositiveQuantity(quantity);
  const result = await prisma.stockAllocation.updateMany({ where: { productId, warehouseId }, data: { quantity: { increment: quantity }, updatedAt: new Date() } });
  if (result.count !== 1) throw new Error(`No stock allocation for product ${productId} at warehouse ${warehouseId}`);
}

export async function syncReleasePendingOrderAllocations(items: OrderLineAllocationRef[]): Promise<void> {
  for (const item of items) if (item.warehouseId) await releaseAllocationReservation(item.productId, item.warehouseId, item.quantity);
}
export async function syncFulfillPendingOrderAllocations(items: OrderLineAllocationRef[]): Promise<void> {
  for (const item of items) if (item.warehouseId) await fulfillAllocationFromPick(item.productId, item.warehouseId, item.quantity, { releaseReservation: true });
}
export async function syncRestoreConfirmedOrderAllocations(items: OrderLineAllocationRef[]): Promise<void> {
  for (const item of items) if (item.warehouseId) await restoreAllocationOnCancelConfirmed(item.productId, item.warehouseId, item.quantity);
}
export async function syncFulfillReactivatedOrderAllocations(items: OrderLineAllocationRef[]): Promise<void> {
  for (const item of items) if (item.warehouseId) await fulfillAllocationFromPick(item.productId, item.warehouseId, item.quantity, { releaseReservation: false });
}
