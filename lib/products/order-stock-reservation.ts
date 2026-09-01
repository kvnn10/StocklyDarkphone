/**
 * REQ-0103 — disjoint pending-order stock reservation (REQ-0102 AC6).
 * Warehouse pick → allocation.reservedQuantity only.
 * No warehouse pick → product.reservedQuantity only.
 * Catalog-level reservation changes use compare-and-swap updates so concurrent
 * pending orders cannot reserve the same unit twice or drive reservations below zero.
 *
 * Fulfillment keeps Product, StockAllocation and InventoryMovement changes in
 * one Prisma transaction so a partial stock update can never be committed.
 */

import { prisma } from "@/prisma/client";
import { getReservedCommitment } from "@/lib/stock-allocation/catalog-quantity-reconcile";
import type { CatalogReconcileAllocationRow } from "@/lib/stock-allocation/catalog-quantity-reconcile";
import { planAllocationDecrements } from "@/lib/products/plan-allocation-decrements";
import { releaseAllocationReservation, reserveAllocationForOrderItem } from "@/lib/products/stock-allocation-order-sync";

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

export async function fulfillPendingOrderLine(line: OrderStockLine): Promise<void> {
  assertPositiveQuantity(line.quantity);

  await prisma.$transaction(async (tx) => {
    if (line.warehouseId) {
      const product = await tx.product.findUnique({
        where: { id: line.productId },
        select: { id: true, quantity: true },
      });
      if (!product || Number(product.quantity) < line.quantity) {
        throw new Error(`Insufficient product stock for ${line.productId}`);
      }

      const allocation = await tx.stockAllocation.findUnique({
        where: { productId_warehouseId: { productId: line.productId, warehouseId: line.warehouseId } },
        select: { id: true, quantity: true, reservedQuantity: true, userId: true },
      });
      if (!allocation || Number(allocation.quantity) < line.quantity || Number(allocation.reservedQuantity ?? 0) < line.quantity) {
        throw new Error(`Insufficient warehouse stock or reservation for ${line.productId}`);
      }

      const productResult = await tx.product.updateMany({
        where: { id: product.id, quantity: product.quantity },
        data: { quantity: { decrement: line.quantity }, updatedAt: new Date() },
      });
      if (productResult.count !== 1) throw new Error(`Stock changed while fulfilling product ${line.productId}; please retry.`);

      const previousStock = allocation.quantity;
      const newStock = previousStock - BigInt(line.quantity);
      const allocationResult = await tx.stockAllocation.updateMany({
        where: { id: allocation.id, quantity: allocation.quantity, reservedQuantity: allocation.reservedQuantity },
        data: { quantity: { decrement: line.quantity }, reservedQuantity: { decrement: line.quantity }, updatedAt: new Date() },
      });
      if (allocationResult.count !== 1) throw new Error(`Warehouse stock changed while fulfilling product ${line.productId}; please retry.`);

      await tx.inventoryMovement.create({
        data: {
          productId: line.productId,
          warehouseId: line.warehouseId,
          userId: allocation.userId,
          type: "exit",
          quantity: -BigInt(line.quantity),
          previousStock,
          newStock,
          reason: "Salida por pedido facturado",
          referenceId: null,
          notes: null,
          createdAt: new Date(),
        },
      });
      return;
    }

    const product = await tx.product.findUnique({
      where: { id: line.productId },
      select: { id: true, quantity: true, reservedQuantity: true },
    });
    if (!product || Number(product.quantity) < line.quantity || Number(product.reservedQuantity ?? 0) < line.quantity) {
      throw new Error(`Insufficient stock or reservation for product ${line.productId}`);
    }

    const allocations = await tx.stockAllocation.findMany({
      where: { productId: line.productId },
      select: { id: true, quantity: true, reservedQuantity: true, warehouseId: true, userId: true },
    });
    const steps = planAllocationDecrements(
      allocations.map((a) => ({ id: a.id, quantity: Number(a.quantity), reservedQuantity: Number(a.reservedQuantity) })),
      line.quantity,
    );
    if (steps.reduce((sum, step) => sum + step.deduct, 0) !== line.quantity) {
      throw new Error(`Insufficient allocated warehouse stock for product ${line.productId}`);
    }

    const productResult = await tx.product.updateMany({
      where: { id: product.id, quantity: product.quantity, reservedQuantity: product.reservedQuantity },
      data: { quantity: { decrement: line.quantity }, reservedQuantity: { decrement: line.quantity }, updatedAt: new Date() },
    });
    if (productResult.count !== 1) throw new Error(`Stock changed while fulfilling product ${line.productId}; please retry.`);

    for (const step of steps) {
      const allocation = allocations.find((a) => a.id === step.id);
      if (!allocation) throw new Error(`Allocation not found for product ${line.productId}`);
      const previousStock = allocation.quantity;
      const newStock = previousStock - BigInt(step.deduct);
      const allocationResult = await tx.stockAllocation.updateMany({
        where: { id: allocation.id, quantity: allocation.quantity, reservedQuantity: allocation.reservedQuantity },
        data: { quantity: { decrement: step.deduct }, updatedAt: new Date() },
      });
      if (allocationResult.count !== 1) throw new Error(`Warehouse stock changed while fulfilling product ${line.productId}; please retry.`);
      await tx.inventoryMovement.create({
        data: {
          productId: line.productId,
          warehouseId: allocation.warehouseId,
          userId: allocation.userId,
          type: "exit",
          quantity: -BigInt(step.deduct),
          previousStock,
          newStock,
          reason: "Salida por pedido facturado",
          referenceId: null,
          notes: "Asignación automática de bodega",
          createdAt: new Date(),
        },
      });
    }
  });
}

export async function reservePendingOrderLines(lines: OrderStockLine[]): Promise<void> {
  const reserved: OrderStockLine[] = [];
  try {
    for (const line of lines) {
      await reservePendingOrderLine(line);
      reserved.push(line);
    }
  } catch (error) {
    for (let index = reserved.length - 1; index >= 0; index -= 1) {
      const reservedLine = reserved[index];
      if (!reservedLine) continue;
      try { await releasePendingOrderLine(reservedLine); } catch { /* reconciliation can repair exceptional release failures */ }
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
