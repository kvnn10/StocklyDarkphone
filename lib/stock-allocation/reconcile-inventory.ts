/**
 * Inventory reconciliation guard.
 *
 * Product.quantity is the catalog total. StockAllocation rows represent the
 * physical warehouse split. Reserved units are protected and are never removed
 * by an automatic repair.
 */

import { prisma } from "@/prisma/client";
import {
  planCatalogQuantityReconcile,
  type CatalogReconcileAllocationRow,
} from "@/lib/stock-allocation/catalog-quantity-reconcile";

export type InventoryReconcileIssue = {
  productId: string;
  sku: string;
  name: string;
  catalogQuantity: number;
  allocatedQuantity: number;
  productReserved: number;
  allocationReserved: number;
  expectedReserved: number;
  kind: "allocation_exceeds_catalog" | "catalog_exceeds_allocation" | "reserved_exceeds_stock";
  repairable: boolean;
  message: string;
};

export type InventoryReconcileResult = {
  checked: number;
  healthy: number;
  issues: InventoryReconcileIssue[];
  repaired: number;
  blocked: number;
};

function toNumber(value: bigint | number): number {
  return Number(value);
}

export async function reconcileInventory(
  userId: string,
  options: { repair?: boolean } = {},
): Promise<InventoryReconcileResult> {
  const products = await prisma.product.findMany({
    where: { userId, deletedAt: null },
    select: { id: true, sku: true, name: true, quantity: true, reservedQuantity: true },
  });

  const allocations = await prisma.stockAllocation.findMany({
    where: { userId },
    select: { id: true, productId: true, warehouseId: true, quantity: true, reservedQuantity: true },
  });

  const byProduct = new Map<string, CatalogReconcileAllocationRow[]>();
  for (const row of allocations) {
    const current = byProduct.get(row.productId) ?? [];
    current.push({
      id: row.id,
      warehouseId: row.warehouseId,
      quantity: toNumber(row.quantity),
      reservedQuantity: toNumber(row.reservedQuantity),
    });
    byProduct.set(row.productId, current);
  }

  const issues: InventoryReconcileIssue[] = [];
  let repaired = 0;
  let blocked = 0;

  for (const product of products) {
    const catalogQuantity = toNumber(product.quantity);
    const productReserved = toNumber(product.reservedQuantity);
    const rows = byProduct.get(product.id) ?? [];
    const allocatedQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const allocationReserved = rows.reduce((sum, row) => sum + row.reservedQuantity, 0);
    const expectedReserved = productReserved + allocationReserved;

    if (expectedReserved > catalogQuantity) {
      issues.push({
        productId: product.id, sku: product.sku, name: product.name,
        catalogQuantity, allocatedQuantity, productReserved, allocationReserved, expectedReserved,
        kind: "reserved_exceeds_stock", repairable: false,
        message: `Reserved commitment (${expectedReserved}) exceeds catalog stock (${catalogQuantity}).`,
      });
      blocked += 1;
      continue;
    }

    if (allocatedQuantity === catalogQuantity) continue;

    if (allocatedQuantity > catalogQuantity) {
      const overage = allocatedQuantity - catalogQuantity;
      // Treat the current allocation total as the old catalog total so the
      // shared planner calculates exactly which unreserved warehouse units can shrink.
      const plan = planCatalogQuantityReconcile({
        currentCatalog: allocatedQuantity,
        newCatalog: catalogQuantity,
        productReserved,
        allocations: rows,
      });
      const repairable = plan.ok && plan.unitsRemoved === overage;

      if (options.repair && repairable) {
        await prisma.$transaction(async (tx) => {
          for (const step of plan.shrinkSteps) {
            await tx.stockAllocation.update({
              where: { id: step.id },
              data: { quantity: { decrement: BigInt(step.deduct) }, updatedAt: new Date() },
            });
          }
        });
        repaired += 1;
        continue;
      }

      issues.push({
        productId: product.id, sku: product.sku, name: product.name,
        catalogQuantity, allocatedQuantity, productReserved, allocationReserved, expectedReserved,
        kind: "allocation_exceeds_catalog", repairable,
        message: repairable
          ? `Warehouse allocations exceed catalog by ${overage} unit(s); only unreserved stock can be safely reduced.`
          : plan.blockedReason ?? `Warehouse allocations exceed catalog by ${overage} unit(s), but reserved stock prevents automatic repair.`,
      });
      if (!repairable) blocked += 1;
      continue;
    }

    issues.push({
      productId: product.id, sku: product.sku, name: product.name,
      catalogQuantity, allocatedQuantity, productReserved, allocationReserved, expectedReserved,
      kind: "catalog_exceeds_allocation", repairable: false,
      message: `Catalog stock exceeds warehouse allocations by ${catalogQuantity - allocatedQuantity} unit(s). No automatic warehouse assignment was made.`,
    });
    blocked += 1;
  }

  return {
    checked: products.length,
    healthy: products.length - issues.length - repaired,
    issues,
    repaired,
    blocked,
  };
}
