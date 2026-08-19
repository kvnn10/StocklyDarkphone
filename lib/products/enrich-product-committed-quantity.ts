/**
 * REQ-0103 — display-only committed quantity for product lists.
 * DB fields stay disjoint; lists expose committedQuantity for badges/available.
 */

import { prisma } from "@/prisma/client";
import { getReservedCommitment } from "@/lib/stock-allocation/catalog-quantity-reconcile";

/** Sum allocation.reservedQuantity per product (one query). */
export async function batchSumAllocationReserved(
  productIds: string[],
): Promise<Map<string, number>> {
  const sums = new Map<string, number>();
  if (productIds.length === 0) return sums;

  const rows = await prisma.stockAllocation.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, reservedQuantity: true },
  });

  for (const row of rows) {
    const prev = sums.get(row.productId) ?? 0;
    sums.set(row.productId, prev + Number(row.reservedQuantity ?? 0));
  }

  return sums;
}

/**
 * Reconcile catalog reservations against the source of truth: pending
 * non-warehouse order lines. This repairs orphaned reservedQuantity values
 * left behind by cancelled/failed test orders without touching warehouse
 * allocation reservations.
 */
export async function reconcileProductReservations(
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return;

  const pendingLines = await prisma.orderItem.findMany({
    where: {
      productId: { in: productIds },
      warehouseId: null,
      order: { status: "pending" },
    },
    select: {
      productId: true,
      quantity: true,
    },
  });

  const desired = new Map<string, number>();
  for (const line of pendingLines) {
    desired.set(
      line.productId,
      (desired.get(line.productId) ?? 0) + Number(line.quantity),
    );
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, reservedQuantity: true },
  });

  await Promise.all(
    products
      .filter((product) => {
        const current = Number(product.reservedQuantity ?? 0);
        const expected = desired.get(product.id) ?? 0;
        return current !== expected;
      })
      .map((product) =>
        prisma.product.update({
          where: { id: product.id },
          data: {
            reservedQuantity: desired.get(product.id) ?? 0,
          },
        }),
      ),
  );
}

/** Effective pending commitment for list display (disjoint paths summed). */
export function computeCommittedQuantity(
  productReserved: number,
  allocationReservedSum: number,
): number {
  return getReservedCommitment(productReserved, [
    {
      id: "sum",
      quantity: 0,
      reservedQuantity: allocationReservedSum,
    },
  ]);
}

export type ProductWithCommittedFields = {
  reservedQuantity?: number | null;
  committedQuantity?: number;
};

/** Attach committedQuantity without mutating reservedQuantity. */
export function withCommittedQuantity<
  T extends { id: string; reservedQuantity?: number | null },
>(product: T, allocationReservedSum: number): T & { committedQuantity: number } {
  const productReserved = Number(product.reservedQuantity ?? 0);
  return {
    ...product,
    committedQuantity: computeCommittedQuantity(
      productReserved,
      allocationReservedSum,
    ),
  };
}

/** Batch-enrich a product list response. */
export async function enrichProductsWithCommittedQuantity<
  T extends { id: string; reservedQuantity?: number | null },
>(products: T[]): Promise<Array<T & { committedQuantity: number }>> {
  const productIds = products.map((p) => p.id);

  // Self-heal stale catalog reservations before calculating the displayed
  // committed quantity. This is intentionally limited to non-warehouse
  // reservations; warehouse reservations remain in stockAllocation.
  await reconcileProductReservations(productIds);

  const allocationSums = await batchSumAllocationReserved(productIds);

  return products.map((product) =>
    withCommittedQuantity(
      product,
      allocationSums.get(product.id) ?? 0,
    ),
  );
}

/** REQ-0105 — single product detail/API enrich (one allocation sum query). */
export async function enrichProductDetailWithCommittedQuantity<
  T extends { id: string; reservedQuantity?: number | null },
>(product: T): Promise<T & { committedQuantity: number }> {
  await reconcileProductReservations([product.id]);
  const allocationSums = await batchSumAllocationReserved([product.id]);
  return withCommittedQuantity(
    product,
    allocationSums.get(product.id) ?? 0,
  );
}

/** Read committed qty from a list row (display-only). */
export function getDisplayCommittedQuantity(
  product: ProductWithCommittedFields,
): number {
  return (
    product.committedQuantity ?? Number(product.reservedQuantity ?? 0)
  );
}
