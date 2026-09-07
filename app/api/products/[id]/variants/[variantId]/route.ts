import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";
import { createAuditLog } from "@/prisma/audit-log";
import { validObjectId } from "@/lib/finance/financial-ledger";
import { invalidateOnProductChange } from "@/lib/cache";
import { mergeProductListWhere } from "@/lib/products/product-query";
import { getSupplierByUserId } from "@/prisma/supplier";

async function getAccessibleVariant(session: { id: string; role: string | null }, productId: string, variantId: string) {
  let accessWhere = {};
  if (session.role === "supplier") { const supplier = await getSupplierByUserId(session.id); if (!supplier) return null; accessWhere = { supplierId: supplier.id }; }
  else if (session.role !== "admin" && session.role !== "client") accessWhere = { userId: session.id };
  return prisma.productVariant.findFirst({ where: { id: variantId, productId, product: mergeProductListWhere(accessWhere) }, include: { product: { select: { id: true, name: true, userId: true } }, stocks: true } });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; variantId: string }> }) {
  const auth = await authorizeRequest(request, "products", "update"); if (auth.response) return auth.response;
  const session = auth.session!; const { id, variantId } = await params;
  if (!validObjectId(id) || !validObjectId(variantId)) return NextResponse.json({ error: "Variante inválida" }, { status: 400 });
  try {
    const existing = await getAccessibleVariant(session, id, variantId); if (!existing) return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 });
    const body = await request.json(); const data: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 100);
    if (typeof body.sku === "string" && body.sku.trim()) data.sku = body.sku.trim();
    if (body.price !== undefined) data.price = Math.max(0, Number(body.price) || 0);
    if (body.purchasePrice !== undefined) data.purchasePrice = Math.max(0, Number(body.purchasePrice) || 0);
    if (body.attributes !== undefined) data.attributes = body.attributes && typeof body.attributes === "object" ? body.attributes : null;
    if (typeof body.status === "string" && body.status) data.status = body.status;
    data.updatedBy = session.id; data.updatedAt = new Date();
    const variant = await prisma.productVariant.update({ where: { id: variantId }, data: data as any, include: { stocks: true } });
    createAuditLog({ userId: session.id, action: "update", entityType: "product_variant", entityId: variant.id, details: { productId: id, variantName: variant.name, sku: variant.sku } }).catch(() => {});
    await invalidateOnProductChange();
    return NextResponse.json({ ...variant, quantity: Number(variant.quantity), reservedQuantity: Number(variant.reservedQuantity), price: Number(variant.price), purchasePrice: Number(variant.purchasePrice), stocks: variant.stocks.map(s => ({ ...s, quantity: Number(s.quantity), reservedQuantity: Number(s.reservedQuantity) })) });
  } catch (error) { const message = error instanceof Error ? error.message : "No se pudo actualizar la variante"; return NextResponse.json({ error: message.includes("Unique constraint") ? "El SKU ya está en uso" : message }, { status: 400 }); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; variantId: string }> }) {
  const auth = await authorizeRequest(request, "products", "delete"); if (auth.response) return auth.response;
  const session = auth.session!; const { id, variantId } = await params;
  if (!validObjectId(id) || !validObjectId(variantId)) return NextResponse.json({ error: "Variante inválida" }, { status: 400 });
  const variant = await getAccessibleVariant(session, id, variantId); if (!variant) return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 });
  if (Number(variant.quantity) > 0 || Number(variant.reservedQuantity) > 0) return NextResponse.json({ error: "No puedes eliminar una variante con stock o unidades reservadas" }, { status: 409 });
  const orderItems = await prisma.orderItem.count({ where: { variantId } }); if (orderItems > 0) return NextResponse.json({ error: "La variante tiene historial de ventas; desactívala en lugar de eliminarla" }, { status: 409 });
  await prisma.productVariant.delete({ where: { id: variantId } });
  createAuditLog({ userId: session.id, action: "delete", entityType: "product_variant", entityId: variantId, details: { productId: id, variantName: variant.name, sku: variant.sku } }).catch(() => {});
  await invalidateOnProductChange(); return NextResponse.json({ success: true });
}
