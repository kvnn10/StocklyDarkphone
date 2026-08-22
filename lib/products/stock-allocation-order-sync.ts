/**
 * REQ-0068 — per-warehouse order picking sync between OrderItem and StockAllocation.
 * Reserves allocation rows on pending create; fulfills/restores on confirm/cancel.
 *
 * REQ-0102 reservation invariant:
 * - Warehouse-pick orders → `StockAllocation.reservedQuantity` only
 * - No warehouse pick (greedy fallback) → `Product.reservedQuantity` only
 * These paths are disjoint; catalog reconcile sums both for the reserved floor.
 */

import { prisma } from "@/prisma/client";
import { getOrderLineWarehouseAvailable } from "@/lib/orders/order-line-stock-validation";

export type WarehousePickOption = {
  warehouseId: string;
  warehouseName: string;
  available: number;
};

export type OrderLineAllocationRef = {
  productId: string;
  warehouseId: string | null;
  quantity: number;
};

function assertPositiveQuantity(quantity: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error(`Invalid stock quantity: ${quantity}`);
  }
}

/** Warehouses with available stock for a product (owner-scoped). */
export async function getProductAllocationWarehouses(
  productId: string,
  ownerUserId: string,
): Promise<WarehousePickOption[]> {
  const allocations = await prisma.stockAllocation.findMany({
    where: { productId },
    select: { warehouseId: true, quantity: true, reservedQuantity: true },
  });
  if (allocations.length === 0) return [];

  const warehouseIds = [...new Set(allocations.map((a) => a.warehouseId))];
  const warehouses = await prisma.warehouse.findMany({
    where: { id: { in: warehouseIds }, userId: ownerUserId },
    select: { id: true, name: true },
  });
  const warehouseMap = new Map(warehouses.map((w) => [w.id, w.name]));

  return allocations
    .flatMap((allocation) => {
      const name = warehouseMap.get(allocation.warehouseId);
      if (!name) return [];
      const available = Number(allocation.quantity) - Number(allocation.reservedQuantity ?? 0);
      if (available <= 0) return [];
      return [{ warehouseId: allocation.warehouseId, warehouseName: name, available }];
    })
    .sort((a, b) => b.available - a.available);
}

/** True when the product owner has at least one warehouse allocation row. */
export async function productRequiresWarehousePick(
  productId: string,
  ownerUserId: string,
): Promise<boolean> {
  const allocations = await prisma.stockAllocation.findMany({
    where: { productId },
    select: { warehouseId: true },
  });
  if (allocations.length === 0) return false;
  const warehouseIds = allocations.map((a) => a.warehouseId);
  return (await prisma.warehouse.count({ where: { id: { in: warehouseIds }, userId: ownerUserId } })) > 0;
}

/** Resolve warehouse name for order line snapshot. */
export async function resolveWarehouseName(
  warehouseId: string,
  ownerUserId: string,
): Promise<string | null> {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, userId: ownerUserId },
    select: { name: true },
  });
  return warehouse?.name ?? null;
}

/** Validate picked warehouse has enough available stock (quantity − reserved). */
export async function validateWarehousePick(
  productId: string,
  warehouseId: string,
  quantity: number,
): Promise<void> {
  assertPositiveQuantity(quantity);
  const allocation = await prisma.stockAllocation.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { quantity: true, reservedQuantity: true },
  });
  if (!allocation) {
    throw new Error(`No stock allocation for product ${productId} at warehouse ${warehouseId}`);
  }

  const maxQty = getOrderLineWarehouseAvailable(
    Number(allocation.quantity),
    Number(allocation.reservedQuantity ?? 0),
  );
  if (quantity > maxQty) {
    const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId }, select: { name: true } });
    throw new Error(`Max ${maxQty} at ${warehouse?.name?.trim() || "warehouse"}`);
  }
}

/** Pending order create — atomically reserve allocation only if enough unreserved stock remains. */
export async function reserveAllocationForOrderItem(
  productId: string,
  warehouseId: string,
  quantity: number,
): Promise<void> {
  assertPositiveQuantity(quantity);
  const result = await prisma.stockAllocation.updateMany({
    where: {
      productId,
      warehouseId,
      quantity: { gte: quantity },
      reservedQuantity: { lte: prisma.stockAllocation.fields.quantity },
    },
    data: { reservedQuantity: { increment: quantity }, updatedAt: new Date() },
  });

  if (result.count !== 1) {
    throw new Error(`Insufficient available stock at warehouse ${warehouseId}`);
  }
}

/** Pending order cancel — atomically release only an existing reservation. */
export async function releaseAllocationReservation(
  productId: string,
  warehouseId: string,
  quantity: number,
): Promise<void> {
  assertPositiveQuantity(quantity);
  const result = await prisma.stockAllocation.updateMany({
    where: {
      productId,
      warehouseId,
      reservedQuantity: { gte: quantity },
    },
    data: { reservedQuantity: { decrement: quantity }, updatedAt: new Date() },
  });
  if (result.count !== 1) {
    throw new Error(`Cannot release ${quantity} reserved units for product ${productId}`);
  }
}

/** Confirm/paid from pending — atomically consume stock and, when applicable, its reservation. */
export async function fulfillAllocationFromPick(
  productId: string,
  warehouseId: string,
  quantity: number,
  options?: { releaseReservation?: boolean },
): Promise<void> {
  assertPositiveQuantity(quantity);
  const releaseReservation = options?.releaseReservation ?? true;
  const result = await prisma.stockAllocation.updateMany({
    where: {
      productId,
      warehouseId,
      quantity: { gte: quantity },
      ...(releaseReservation ? { reservedQuantity: { gte: quantity } } : {}),
    },
    data: {
      quantity: { decrement: quantity },
      ...(releaseReservation ? { reservedQuantity: { decrement: quantity } } : {}),
      updatedAt: new Date(),
    },
  });
  if (result.count !== 1) {
    throw new Error(`Insufficient stock/reservation at warehouse ${warehouseId}`);
  }
}

/** Confirmed/paid order cancel — restore allocation quantity at picked warehouse. */
export async function restoreAllocationOnCancelConfirmed(
  productId: string,
  warehouseId: string,
  quantity: number,
): Promise<void> {
  assertPositiveQuantity(quantity);
  const result = await prisma.stockAllocation.updateMany({
    where: { productId, warehouseId },
    data: { quantity: { increment: quantity }, updatedAt: new Date() },
  });
  if (result.count !== 1) {
    throw new Error(`No stock allocation for product ${productId} at warehouse ${warehouseId}`);
  }
}

export async function syncReleasePendingOrderAllocations(items: OrderLineAllocationRef[]): Promise<void> {
  for (const item of items) {
    if (!item.warehouseId) continue;
    await releaseAllocationReservation(item.productId, item.warehouseId, item.quantity);
  }
}

export async function syncFulfillPendingOrderAllocations(items: OrderLineAllocationRef[]): Promise<void> {
  for (const item of items) {
    if (!item.warehouseId) continue;
    await fulfillAllocationFromPick(item.productId, item.warehouseId, item.quantity, { releaseReservation: true });
  }
}

export async function syncRestoreConfirmedOrderAllocations(items: OrderLineAllocationRef[]): Promise<void> {
  for (const item of items) {
    if (!item.warehouseId) continue;
    await restoreAllocationOnCancelConfirmed(item.productId, item.warehouseId, item.quantity);
  }
}

export async function syncFulfillReactivatedOrderAllocations(items: OrderLineAllocationRef[]): Promise<void> {
  for (const item of items) {
    if (!item.warehouseId) continue;
    await fulfillAllocationFromPick(item.productId, item.warehouseId, item.quantity, { releaseReservation: false });
  }
}
