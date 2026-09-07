import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";
import { createAuditLog } from "@/prisma/audit-log";
import { validObjectId } from "@/lib/finance/financial-ledger";
import { invalidateOnProductChange } from "@/lib/cache";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(request, "products", "read");
  if (auth.response) return auth.response;
  const session = auth.session!;
  const { id } = await params;
  if (!validObjectId(id)) return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
  const product = await prisma.product.findFirst({ where: { id, userId: session.id, deletedAt: null }, select: { id: true } });
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  const variants = await prisma.productVariant.findMany({ where: { productId: id, userId: session.id }, include: { stocks: true }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(variants.map(v => ({ ...v, quantity: Number(v.quantity), reservedQuantity: Number(v.reservedQuantity), price: Number(v.price), purchasePrice: Number(v.purchasePrice), stocks: v.stocks.map(s => ({ ...s, quantity: Number(s.quantity), reservedQuantity: Number(s.reservedQuantity) })) })));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(request, "products", "create");
  if (auth.response) return auth.response;
  const session = auth.session!;
  const { id } = await params;
  if (!validObjectId(id)) return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
  try {
    const product = await prisma.product.findFirst({ where: { id, userId: session.id, deletedAt: null } });
    if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    const sku = typeof body.sku === "string" ? body.sku.trim() : "";
    if (!name || !sku) return NextResponse.json({ error: "La variante necesita nombre y SKU" }, { status: 400 });
    const price = Math.max(0, Number(body.price) || 0);
    const purchasePrice = Math.max(0, Number(body.purchasePrice) || 0);
    const attributes = body.attributes && typeof body.attributes === "object" ? body.attributes : null;
    const variant = await prisma.productVariant.create({ data: { productId: product.id, name, attributes, sku, price, purchasePrice, quantity: 0n, reservedQuantity: 0n, status: typeof body.status === "string" && body.status ? body.status : "available", userId: session.id, createdBy: session.id, createdAt: new Date() } });
    createAuditLog({ userId: session.id, action: "create", entityType: "product_variant", entityId: variant.id, details: { productId: product.id, productName: product.name, variantName: name, sku } }).catch(() => {});
    await invalidateOnProductChange();
    return NextResponse.json({ ...variant, quantity: 0, reservedQuantity: 0, price: Number(variant.price), purchasePrice: Number(variant.purchasePrice), stocks: [] }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la variante";
    return NextResponse.json({ error: message.includes("Unique constraint") ? "El SKU ya está en uso" : message }, { status: 400 });
  }
}
