import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";
import { createAuditLog } from "@/prisma/audit-log";
import { validObjectId } from "@/lib/finance/financial-ledger";
import { invalidateOnProductChange } from "@/lib/cache";
import { mergeProductListWhere } from "@/lib/products/product-query";
import { getSupplierByUserId } from "@/prisma/supplier";

async function getAccessibleProduct(id: string, session: { id: string; role: string | null }) {
  let accessWhere = {};
  if (session.role === "supplier") { const supplier = await getSupplierByUserId(session.id); if (!supplier) return null; accessWhere = { supplierId: supplier.id }; }
  else if (session.role !== "admin" && session.role !== "client") accessWhere = { userId: session.id };
  return prisma.product.findFirst({ where: mergeProductListWhere({ id, ...accessWhere }), select: { id: true, userId: true, name: true } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(request, "products", "read"); if (auth.response) return auth.response;
  const session = auth.session!; const { id } = await params;
  if (!validObjectId(id)) return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
  const product = await getAccessibleProduct(id, session); if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  const variants = await prisma.productVariant.findMany({ where: { productId: product.id }, include: { stocks: true }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(variants.map(v => ({ ...v, quantity: Number(v.quantity), reservedQuantity: Number(v.reservedQuantity), price: Number(v.price), purchasePrice: Number(v.purchasePrice), stocks: v.stocks.map(s => ({ ...s, quantity: Number(s.quantity), reservedQuantity: Number(s.reservedQuantity) })) })));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(request, "products", "create"); if (auth.response) return auth.response;
  const session = auth.session!; const { id } = await params;
  if (!validObjectId(id)) return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
  try {
    const product = await getAccessibleProduct(id, session); if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    const body = await request.json(); const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : ""; const sku = typeof body.sku === "string" ? body.sku.trim() : "";
    if (!name || !sku) return NextResponse.json({ error: "La variante necesita nombre y SKU" }, { status: 400 });
    const price = Math.max(0, Number(body.price) || 0); const purchasePrice = Math.max(0, Number(body.purchasePrice) || 0); const attributes = body.attributes && typeof body.attributes === "object" ? body.attributes : null; const initialQuantity = Math.max(0, Math.floor(Number(body.initialQuantity) || 0)); const warehouseId = typeof body.warehouseId === "string" && validObjectId(body.warehouseId) ? body.warehouseId : null;
    if (initialQuantity > 0 && !warehouseId) return NextResponse.json({ error: "Selecciona una bodega para el stock inicial de la variante" }, { status: 400 });
    if (warehouseId) { const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, userId: product.userId }, select: { id: true } }); if (!warehouse) return NextResponse.json({ error: "Bodega no encontrada" }, { status: 404 }); }
    const variant = await prisma.productVariant.create({ data: { productId: product.id, name, attributes, sku, price, purchasePrice, quantity: BigInt(initialQuantity), reservedQuantity: 0n, status: initialQuantity > 0 ? "available" : "stock_out", userId: product.userId, createdBy: session.id, createdAt: new Date(), stocks: warehouseId && initialQuantity > 0 ? { create: { warehouseId, quantity: BigInt(initialQuantity), reservedQuantity: 0n, userId: product.userId, createdAt: new Date(), updatedAt: new Date() } } : undefined } });
    const aggregateQuantity = await prisma.productVariant.aggregate({ where: { productId: product.id }, _sum: { quantity: true } }); const legacyStock = await prisma.stockAllocation.aggregate({ where: { productId: product.id, userId: product.userId }, _sum: { quantity: true } }); const totalQuantity = BigInt(aggregateQuantity._sum.quantity ?? 0n) + BigInt(legacyStock._sum.quantity ?? 0n);
    await prisma.product.update({ where: { id: product.id }, data: { quantity: totalQuantity, status: totalQuantity > 0n ? "available" : "stock_out", updatedAt: new Date(), updatedBy: session.id } });
    createAuditLog({ userId: session.id, action: "create", entityType: "product_variant", entityId: variant.id, details: { productId: product.id, productName: product.name, variantName: name, sku, initialQuantity } }).catch(() => {}); await invalidateOnProductChange();
    return NextResponse.json({ ...variant, quantity: initialQuantity, reservedQuantity: 0, price: Number(variant.price), purchasePrice: Number(variant.purchasePrice), stocks: [] }, { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "No se pudo crear la variante"; return NextResponse.json({ error: message.includes("Unique constraint") ? "El SKU ya está en uso" : message }, { status: 400 }); }
}
