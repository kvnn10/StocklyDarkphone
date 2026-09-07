import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, "products", "read");
  if (auth.response) return auth.response;
  const session = auth.session!;

  const variants = await prisma.productVariant.findMany({
    where: { userId: session.id, product: { deletedAt: null } },
    include: {
      stocks: {
        include: { warehouse: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ productId: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(
    variants.map((variant) => ({
      id: variant.id,
      productId: variant.productId,
      name: variant.name,
      sku: variant.sku,
      price: Number(variant.price),
      purchasePrice: Number(variant.purchasePrice),
      quantity: Number(variant.quantity),
      reservedQuantity: Number(variant.reservedQuantity),
      status: variant.status,
      attributes: variant.attributes,
      stocks: variant.stocks.map((stock) => ({
        id: stock.id,
        warehouseId: stock.warehouseId,
        warehouseName: stock.warehouse?.name ?? "Bodega",
        quantity: Number(stock.quantity),
        reservedQuantity: Number(stock.reservedQuantity),
      })),
    })),
  );
}
