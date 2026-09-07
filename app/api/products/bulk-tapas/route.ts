import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";
import { createAuditLog } from "@/prisma/audit-log";

const LOT = [
  { model: "iPhone 15 Pro", color: "Negra", quantity: 2 },
  { model: "iPhone 15 Pro", color: "Azul", quantity: 2 },
  { model: "iPhone 15 Pro", color: "Blanca", quantity: 1 },
  { model: "iPhone 15 Pro Max", color: "Azul", quantity: 2 },
  { model: "iPhone 15 Pro Max", color: "Negra", quantity: 6 },
  { model: "iPhone 15 Pro Max", color: "Natural", quantity: 5 },
  { model: "iPhone 15 Pro Max", color: "Blanca", quantity: 2 },
  { model: "iPhone 16 Pro", color: "Dorada", quantity: 2 },
  { model: "iPhone 16 Pro", color: "Negra", quantity: 1 },
  { model: "iPhone 16 Pro", color: "Blanca", quantity: 1 },
  { model: "iPhone 16 Pro Max", color: "Dorada", quantity: 6 },
  { model: "iPhone 16 Pro Max", color: "Negra", quantity: 5 },
  { model: "iPhone 16 Pro Max", color: "Natural", quantity: 4 },
  { model: "iPhone 16 Pro Max", color: "Blanca", quantity: 4 },
] as const;

const COST = 15000;
const PRICE = 50000;
const CATEGORY = "Tapas";
const WAREHOUSE = "Darkphone";

function slug(value: string) {
  return value.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function POST(request: NextRequest) {
  try {
    const authorization = await authorizeRequest(request, "products", "adjust_stock");
    if (authorization.response) return authorization.response;
    const session = authorization.session;
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const warehouse = await prisma.warehouse.findFirst({
      where: { userId: session.id, status: true, name: { equals: WAREHOUSE } },
    });
    if (!warehouse) {
      return NextResponse.json({ error: `No se encontró la bodega ${WAREHOUSE}.` }, { status: 404 });
    }

    const category = await prisma.category.findFirst({
      where: { userId: session.id, name: { equals: CATEGORY } },
    });
    if (!category) {
      return NextResponse.json({ error: `No se encontró la categoría ${CATEGORY}.` }, { status: 404 });
    }

    const supplier = await prisma.supplier.findFirst({
      where: { userId: session.id, status: true },
      orderBy: { createdAt: "asc" },
    });
    if (!supplier) {
      return NextResponse.json({ error: "Necesitas al menos un proveedor activo para cargar el lote." }, { status: 409 });
    }

    const products = new Map<string, typeof LOT[number][]>();
    for (const item of LOT) products.set(item.model, [...(products.get(item.model) ?? []), item]);

    const result = await prisma.$transaction(async (tx) => {
      const imported: Array<{ product: string; variant: string; quantity: number }> = [];

      for (const [model, items] of products) {
        const productSku = `TAPA-${slug(model)}`.toUpperCase();
        let product = await tx.product.findFirst({ where: { userId: session.id, name: model, categoryId: category.id, deletedAt: null } });

        if (!product) {
          product = await tx.product.create({
            data: {
              name: model,
              sku: productSku,
              purchasePrice: COST,
              price: PRICE,
              quantity: BigInt(0),
              status: "available",
              categoryId: category.id,
              supplierId: supplier.id,
              userId: session.id,
              createdBy: session.id,
              updatedAt: null,
            },
          });
        }

        for (const item of items) {
          const variantSku = `${productSku}-${slug(item.color)}`.toUpperCase();
          let variant = await tx.productVariant.findFirst({ where: { productId: product.id, name: item.color } });

          if (!variant) {
            variant = await tx.productVariant.create({
              data: {
                productId: product.id,
                name: item.color,
                attributes: { Color: item.color },
                sku: variantSku,
                purchasePrice: COST,
                price: PRICE,
                quantity: BigInt(0),
                status: "available",
                userId: session.id,
                createdBy: session.id,
              },
            });
          }

          const stock = await tx.productVariantStock.findUnique({ where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } } });
          const previousStock = Number(stock?.quantity ?? 0);
          if (previousStock > 0) {
            throw new Error(`La variante ${model} - ${item.color} ya tiene ${previousStock} unidades en Darkphone. Carga cancelada para evitar duplicados.`);
          }

          await tx.productVariantStock.upsert({
            where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
            create: { variantId: variant.id, warehouseId: warehouse.id, quantity: BigInt(item.quantity), reservedQuantity: BigInt(0), userId: session.id },
            update: { quantity: BigInt(item.quantity), updatedAt: new Date() },
          });

          await tx.productVariant.update({ where: { id: variant.id }, data: { quantity: BigInt(item.quantity), purchasePrice: COST, price: PRICE, updatedBy: session.id, updatedAt: new Date() } });
          await tx.inventoryMovement.create({
            data: {
              productId: product.id,
              variantId: variant.id,
              warehouseId: warehouse.id,
              userId: session.id,
              type: "in",
              quantity: BigInt(item.quantity),
              previousStock: BigInt(previousStock),
              newStock: BigInt(item.quantity),
              reason: "Carga inicial de lote de tapas",
              notes: `Lote tapas — costo $${COST.toLocaleString("es-CO")} / venta $${PRICE.toLocaleString("es-CO")}`,
            },
          });
          imported.push({ product: model, variant: item.color, quantity: item.quantity });
        }

        const variants = await tx.productVariant.findMany({ where: { productId: product.id } });
        const totalQuantity = variants.reduce((sum, v) => sum + Number(v.quantity), 0);
        await tx.product.update({ where: { id: product.id }, data: { quantity: BigInt(totalQuantity), purchasePrice: COST, price: PRICE, status: totalQuantity > 0 ? "available" : "stock_out", updatedBy: session.id, updatedAt: new Date() } });
      }

      return imported;
    });

    await createAuditLog({
      userId: session.id,
      action: "import",
      entityType: "product",
      details: { type: "tapas_lot", warehouse: WAREHOUSE, category: CATEGORY, units: result.reduce((sum, x) => sum + x.quantity, 0), cost: COST, price: PRICE, items: result },
    });

    return NextResponse.json({
      ok: true,
      message: "Lote de tapas cargado correctamente.",
      warehouse: WAREHOUSE,
      units: result.reduce((sum, x) => sum + x.quantity, 0),
      totalCost: result.reduce((sum, x) => sum + x.quantity, 0) * COST,
      potentialSales: result.reduce((sum, x) => sum + x.quantity, 0) * PRICE,
      items: result,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar el lote.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
