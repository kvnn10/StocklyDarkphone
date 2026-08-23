/**
 * REQ-0103 — disjoint pending-order stock reservation (REQ-0102 AC6).
 * Warehouse pick → allocation.reservedQuantity only.
 * No warehouse pick → product.reservedQuantity only.
 * Catalog-level reservation changes use compare-and-swap updates so concurrent
 * pending orders cannot reserve the same unit twice or drive reservations below zero.
 */

import { prisma } from "@/prisma/client";
import { getReservedCommitment } from "@/lib/stock-allocation/catalog-quantity-reconcile";
import type { CatalogReconcileAllocationRow } from "@/lib/stock-allocation/catalog-quantity-reconcile";
import { decrementStockAllocations } from "@/lib/products/decrement-stock-allocations";
import { fulfillAllocationFromPick, releaseAllocationReservation, reserveAllocationForOrderItem } from "@/lib/products/stock-allocation-order-sync";

export type OrderStockLine = { productId: string; quantity: number; warehouseId?: string | null };

function assertPositiveQuantity(quantity: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) throw new Error(`Invalid stock quantity: ${quantity}`);
}

export function getAvailableCatalogForOrder(
  productQty: number,
  productReserved: number,
  allocationRows: Pick<CatalogReconcileAllocationRow, "reservedQuantity">[],
): number {
  const committed = getReservedCommitment(productReserved, allocationRows.map((row, index) => ({ id: String(index), quantity: 0, reservedQuantity: row.reservedQuantity })));
  return Math.max(0, productQty - committed);
}

/** Pending create — reserve on exactly one path per line. */
export async function reservePendingOrderLine(line: OrderStockLine): Promise<void> {
  assertPositiveQuantity(line.quantity);
  if (line.warehouseId) {
    await reserveAllocationForOrderItem(line.productId, line.warehouseId, line.quantity);
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const product = await prisma.product.findUnique({ where: { id: line.productId }, select: { id: true, quantity: true, reservedQuantity: true } });
    if (!product) throw new Error(`Product ${line.productId} not found`);
    const quantity = Number(product.quantity);
    const reserved = Number(product.reservedQuantity ?? 0);
    if (quantity - reserved < line.quantity) throw new Error(`Insufficient available stock for product ${line.productId}`);
    const result = await prisma.product.updateMany({
      where: { id: product.id, quantity: product.quantity, reservedQuantity: product.reservedQuantity },
      data: { reservedQuantity: { increment: line.quantity }, updatedAt: new Date() },
    });
    if (result.count === 1) return;
  }
  throw new Error("Stock changed while reserving the product; please retry the order.");
}

/** Pending cancel — release only a reservation that is actually present. */
export async function releasePendingOrderLine(line: OrderStockLine): Promise<void> {
  assertPositiveQuantity(line.quantity);
  if (line.warehouseId) {
    await releaseAllocationReservation(line.productId, line.warehouseId, line.quantity);
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const product = await prisma.product.findUnique({ where: { id: line.productId }, select: { id: true, reservedQuantity: true } });
    if (!product) throw new Error(`Product ${line.productId} not found`);
    if (Number(product.reservedQuantity ?? 0) < line.quantity) throw new Error(`Cannot release ${line.quantity} reserved units for product ${line.productId}`);
    const result = await prisma.product.updateMany({
      where: { id: product.id, reservedQuantity: product.reservedQuantity },
      data: { reservedQuantity: { decrement: line.quantity }, updatedAt: new Date() },
    });
    if (result.count === 1) return;
  }
  throw new Error("Stock changed while releasing the reservation; please retry.");
}

/** Pending → confirmed/paid — deduct catalog and clear reservation on one path. */
export async function fulfillPendingOrderLine(line: OrderStockLine): Promise<void> {
  assertPositiveQuantity(line.quantity);
  if (line.warehouseId) {
    const productResult = await prisma.product.updateMany({
      where: { id: line.productId, quantity: { gte: line.quantity } },
      data: { quantity: { decrement: line.quantity }, updatedAt: new Date() },
    });
    if (productResult.count !== 1) throw new Error(`Insufficient product stock for ${line.productId}`);
    await fulfillAllocationFromPick(line.productId, line.warehouseId, line.quantity, { releaseReservation: true });
    return;
  }

  const productResult = await prisma.product.updateMany({
    where: { id: line.productId, quantity: { gte: line.quantity }, reservedQuantity: { gte: line.quantity } },
    data: { quantity: { decrement: line.quantity }, reservedQuantity: { decrement: line.quantity }, updatedAt: new Date() },
  });
  if (productResult.count !== 1) throw new Error(`Insufficient stock or reservation for product ${line.productId}`);

  await decrementStockAllocations([{ productId: line.productId, quantity: line.quantity }]);
}

/**
 * Reserve every line as one logical operation. If a later line fails, release
 * every reservation already created by this call so we never leave partial
 * stock reservations behind.
 */
export async function reservePendingOrderLines(lines: OrderStockLine[]): Promise<void> {
  const reserved: OrderStockLine[] = [];
  try {
    for (const line of lines) {
      await reservePendingOrderLine(line);
      reserved.push(line);
    }
  } catch (error) {
    for (let index = reserved.length - 1; index >= 0; index -= 1) {
      try {
        await releasePendingOrderLine(reserved[index]);
      } catch {
        // Preserve the original reservation failure; a later reconciliation
        // can repair an exceptional release failure without masking the cause.
      }
    }
    throw error;
  }
}

export async function releasePendingOrderLines(lines: OrderStockLine[]): Promise<void> {
  for (const line of lines) await releasePendingOrderLine(line);
}
export async function fulfillPendingOrderLines(lines: OrderStockLine[]): Promise<void> {
  for (const line of lines) await fulfillPendingOrderLine(line);
}
