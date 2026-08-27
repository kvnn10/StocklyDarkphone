import { prisma } from "@/prisma/client";

/**
 * Centralized low-stock calculation.
 * The current Product model does not expose a minimumStock field, so the
 * service deliberately uses the application's existing stock threshold of
 * 20 rather than referencing a non-existent Prisma property.
 */
const DEFAULT_LOW_STOCK_THRESHOLD = 20;

export async function getLowStockAlerts(userId: string) {
  const allocations = await prisma.stockAllocation.findMany({
    where: { userId },
    include: {
      product: { select: { id: true, name: true, sku: true, status: true } },
      warehouse: { select: { id: true, name: true } },
    },
  });

  return allocations
    .map((allocation) => {
      const available = Number(allocation.quantity) - Number(allocation.reservedQuantity);
      return { allocation, available };
    })
    .filter(({ available }) => available >= 0 && available <= DEFAULT_LOW_STOCK_THRESHOLD)
    .map(({ allocation, available }) => ({
      productId: allocation.productId,
      productName: allocation.product?.name,
      sku: allocation.product?.sku,
      warehouseId: allocation.warehouseId,
      warehouseName: allocation.warehouse?.name,
      available,
      threshold: DEFAULT_LOW_STOCK_THRESHOLD,
    }));
}
