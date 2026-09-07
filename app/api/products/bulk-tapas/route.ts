import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";
import { createAuditLog } from "@/prisma/audit-log";

function slug(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function numberValue(value: unknown) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : NaN; }
type Row = { product: string; variant?: string; sku?: string; quantity: number; purchasePrice: number; price: number; warehouse?: string; category?: string };
const DEFAULT_TAPAS = [
  ["iPhone 15 Pro", "Negra", 2], ["iPhone 15 Pro", "Azul", 2], ["iPhone 15 Pro", "Blanca", 1],
  ["iPhone 15 Pro Max", "Azul", 2], ["iPhone 15 Pro Max", "Negra", 6], ["iPhone 15 Pro Max", "Natural", 5], ["iPhone 15 Pro Max", "Blanca", 2],
  ["iPhone 16 Pro", "Dorada", 2], ["iPhone 16 Pro", "Negra", 1], ["iPhone 16 Pro", "Blanca", 1],
  ["iPhone 16 Pro Max", "Dorada", 6], ["iPhone 16 Pro Max", "Negra", 5], ["iPhone 16 Pro Max", "Natural", 4], ["iPhone 16 Pro Max", "Blanca", 4],
] as const;

export async function POST(request: NextRequest) {
  try {
    const authorization = await authorizeRequest(request, "products", "adjust_stock");
    if (authorization.response) return authorization.response;
    const session = authorization.session;
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const customRows: Row[] = Array.isArray(body?.rows) ? body.rows : [];
    const rows: Row[] = customRows.length ? customRows : DEFAULT_TAPAS.map(([product, variant, quantity]) => ({ product, variant, quantity, purchasePrice: 15000, price: 50000, warehouse: "Darkphone", category: "Tapas" }));
    if (rows.length > 200) return NextResponse.json({ error: "Máximo 200 líneas por lote." }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const imported: Array<{ product: string; variant: string | null; quantity: number; purchasePrice: number; price: number; warehouse: string; action: string }> = [];
      let totalCost = 0, potentialSales = 0;
      for (const row of rows) {
        const productName = String(row.product || "").trim(), variantName = row.variant ? String(row.variant).trim() : "";
        const quantity = numberValue(row.quantity), purchasePrice = numberValue(row.purchasePrice), price = numberValue(row.price);
        if (!productName || quantity <= 0 || !Number.isInteger(quantity) || !Number.isFinite(purchasePrice) || !Number.isFinite(price)) throw new Error(`Línea inválida para ${productName || "producto sin nombre"}. Revisa cantidad y precios.`);
        const warehouseName = String(row.warehouse || "Darkphone").trim();
        const warehouse = await tx.warehouse.findFirst({ where: { userId: session.id, status: true, name: { equals: warehouseName } } });
        if (!warehouse) throw new Error(`No se encontró la bodega ${warehouseName}.`);
        const categoryName = String(row.category || "").trim();
        const category = categoryName ? await tx.category.findFirst({ where: { userId: session.id, name: { equals: categoryName } } }) : await tx.category.findFirst({ where: { userId: session.id }, orderBy: { name: "asc" } });
        if (!category) throw new Error(`No se encontró la categoría ${categoryName || "predeterminada"}.`);
        const supplier = await tx.supplier.findFirst({ where: { userId: session.id, status: true }, orderBy: { createdAt: "asc" } });
        if (!supplier) throw new Error("Necesitas al menos un proveedor activo para cargar inventario.");
        let product = await tx.product.findFirst({ where: { userId: session.id, name: productName, categoryId: category.id, deletedAt: null } });
        let action = "Producto nuevo";
        if (!product) {
          const baseSku = (row.sku || `IMP-${slug(productName)}`).toUpperCase(); let productSku = baseSku, suffix = 1;
          while (await tx.product.findUnique({ where: { sku: productSku }, select: { id: true } })) productSku = `${baseSku}-${suffix++}`;
          product = await tx.product.create({ data: { name: productName, sku: productSku, purchasePrice, price, quantity: BigInt(0), status: "available", categoryId: category.id, supplierId: supplier.id, userId: session.id, createdBy: session.id, updatedAt: null } });
        } else action = variantName ? "Actualizar variante" : "Actualizar producto";
        if (variantName) {
          let variant = await tx.productVariant.findFirst({ where: { productId: product.id, name: variantName } });
          if (!variant) {
            const baseSku = (row.sku || `${product.sku}-${slug(variantName)}`).toUpperCase(); let variantSku = baseSku, suffix = 1;
            while (await tx.productVariant.findUnique({ where: { sku: variantSku }, select: { id: true } })) variantSku = `${baseSku}-${suffix++}`;
            variant = await tx.productVariant.create({ data: { productId: product.id, name: variantName, attributes: { Variante: variantName }, sku: variantSku, purchasePrice, price, quantity: BigInt(0), status: "available", userId: session.id, createdBy: session.id } }); action = "Nueva variante";
          }
          const stock = await tx.productVariantStock.findUnique({ where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } } });
          const previousStock = Number(stock?.quantity ?? 0), newStock = previousStock + quantity;
          await tx.productVariantStock.upsert({ where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } }, create: { variantId: variant.id, warehouseId: warehouse.id, quantity: BigInt(quantity), reservedQuantity: BigInt(0), userId: session.id }, update: { quantity: BigInt(newStock), updatedAt: new Date() } });
          const allStocks = await tx.productVariantStock.findMany({ where: { variantId: variant.id }, select: { quantity: true } });
          const variantTotal = allStocks.reduce((sum, item) => sum + Number(item.quantity), 0);
          await tx.productVariant.update({ where: { id: variant.id }, data: { quantity: BigInt(variantTotal), purchasePrice, price, status: variantTotal > 0 ? "available" : "stock_out", updatedBy: session.id, updatedAt: new Date() } });
          await tx.inventoryMovement.create({ data: { productId: product.id, variantId: variant.id, warehouseId: warehouse.id, userId: session.id, type: "in", quantity: BigInt(quantity), previousStock: BigInt(previousStock), newStock: BigInt(newStock), reason: "Carga masiva de inventario", notes: `Carga confirmada desde texto — costo $${purchasePrice.toLocaleString("es-CO")} / venta $${price.toLocaleString("es-CO")}` } });
          const productVariants = await tx.productVariant.findMany({ where: { productId: product.id }, select: { quantity: true } });
          const productQuantity = productVariants.reduce((sum, item) => sum + Number(item.quantity), 0);
          await tx.product.update({ where: { id: product.id }, data: { quantity: BigInt(productQuantity), purchasePrice, price, status: productQuantity > 0 ? "available" : "stock_out", updatedBy: session.id, updatedAt: new Date() } });
        } else {
          const previousStock = Number(product.quantity), newStock = previousStock + quantity;
          await tx.product.update({ where: { id: product.id }, data: { quantity: BigInt(newStock), purchasePrice, price, status: "available", updatedBy: session.id, updatedAt: new Date() } });
          await tx.inventoryMovement.create({ data: { productId: product.id, warehouseId: warehouse.id, userId: session.id, type: "in", quantity: BigInt(quantity), previousStock: BigInt(previousStock), newStock: BigInt(newStock), reason: "Carga masiva de inventario", notes: `Carga confirmada desde texto — costo $${purchasePrice.toLocaleString("es-CO")} / venta $${price.toLocaleString("es-CO")}` } });
        }
        imported.push({ product: productName, variant: variantName || null, quantity, purchasePrice, price, warehouse: warehouseName, action }); totalCost += quantity * purchasePrice; potentialSales += quantity * price;
      }
      return { imported, totalCost, potentialSales };
    });
    await createAuditLog({ userId: session.id, action: "import", entityType: "product", details: { type: customRows.length ? "text_bulk_import" : "tapas_lot", units: result.imported.reduce((s, r) => s + r.quantity, 0), totalCost: result.totalCost, potentialSales: result.potentialSales, items: result.imported } });
    return NextResponse.json({ ok: true, ...result, units: result.imported.reduce((s, r) => s + r.quantity, 0) }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar el lote." }, { status: 400 }); }
}
