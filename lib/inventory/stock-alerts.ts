import { prisma } from "@/prisma/client";

export async function getLowStockAlerts(userId: string) {
  const allocations = await prisma.stockAllocation.findMany({
    where: { userId },
    include: { product: { select: { id: true, name: true, sku: true, status: true } }, warehouse: { select: { id: true, name: true } } },
  });
  return allocations
    .filter((a: any) => {
      const product = a.product as any;
      const minimum = Number(product?.minimumStock ?? product?.minStock ?? 0);
      return minimum > 0 && Number(a.quantity) - Number(a.reservedQuantity) <= minimum;
    })
    .map((a: any) => ({
      productId: a.productId,
      productName: a.product?.name,
      sku: a.product?.sku,
      warehouseId: a.warehouseId,
      warehouseName: a.warehouse?.name,
      available: Number(a.quantity) - Number(a.reservedQuantity),
    }));
}
