/**
 * Decrement warehouse stock allocations when product-level stock is sold.
 * REQ-0068: when warehouseId is set on the line, fulfill that pick; otherwise
 * greedily deduct from the largest available allocation (legacy / no pick).
 *
 * Automatic sales are also written to InventoryMovement so the Kardex remains
 * consistent with warehouse allocation changes.
 */

import { prisma } from "@/prisma/client";
import { planAllocationDecrements } from "@/lib/products/plan-allocation-decrements";
import { fulfillAllocationFromPick } from "@/lib/products/stock-allocation-order-sync";

export interface DecrementStockAllocationItem {
  productId: string;
  quantity: number;
  /** REQ-0068 — explicit warehouse pick from OrderItem */
  warehouseId?: string | null;
}

/**
 * Best-effort decrement of StockAllocation rows for order line items.
 * Uses quantity − reservedQuantity as available for greedy fallback.
 */
export async function decrementStockAllocations(
  items: DecrementStockAllocationItem[],
): Promise<void> {
  for (const item of items) {
    if (item.quantity <= 0) continue;

    if (item.warehouseId) {
      try {
        await fulfillAllocationFromPick(
          item.productId,
          item.warehouseId,
          item.quantity,
          { releaseReservation: true },
        );
      } catch {
        // best-effort — product-level stock already adjusted
      }
      continue;
    }

    const allocations = await prisma.stockAllocation.findMany({
      where: { productId: item.productId },
      select: { id: true, quantity: true, reservedQuantity: true, warehouseId: true, userId: true },
    });

    const steps = planAllocationDecrements(
      allocations.map((a) => ({
        id: a.id,
        quantity: Number(a.quantity),
        reservedQuantity: Number(a.reservedQuantity),
      })),
      item.quantity,
    );

    for (const step of steps) {
      const allocation = allocations.find((a) => a.id === step.id);
      if (!allocation) continue;
      const previousStock = allocation.quantity;
      const newStock = previousStock - BigInt(step.deduct);
      await prisma.stockAllocation.update({
        where: { id: step.id },
        data: {
          quantity: { decrement: step.deduct },
          updatedAt: new Date(),
        },
      });
      await prisma.inventoryMovement.create({
        data: {
          productId: item.productId,
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
  }
}
