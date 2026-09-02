import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { financeDb, jsonSafe, nextDocumentNumber, oid, validObjectId } from "@/lib/finance/financial-ledger";
import { prisma } from "@/prisma/client";
import { createOrder } from "@/prisma/order";
import { writeAuditLog } from "@/lib/audit/log";

const ROLES = ["admin", "user", "retailer"];

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = await financeDb();
  const rows = await db.collection("Quote").find({ userId: oid(session.id) }).sort({ createdAt: -1 }).limit(300).toArray();
  return NextResponse.json(rows.map(jsonSafe));
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: "La cotización requiere al menos un producto" }, { status: 400 });
    const items: any[] = [];
    let subtotal = 0;
    for (const line of body.items) {
      if (!validObjectId(line.productId)) return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
      const quantity = Number(line.quantity); if (!Number.isInteger(quantity) || quantity <= 0) return NextResponse.json({ error: "Cantidad inválida" }, { status: 400 });
      const product = await prisma.product.findFirst({ where: { id: line.productId, userId: session.id, deletedAt: null } });
      if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
      const price = Number.isFinite(Number(line.price)) && Number(line.price) >= 0 ? Number(line.price) : Number(product.price);
      const lineSubtotal = price * quantity; subtotal += lineSubtotal;
      items.push({ productId: oid(product.id), productName: product.name, sku: product.sku, quantity, price, purchasePrice: Number(product.purchasePrice ?? 0), subtotal: lineSubtotal });
    }
    const discount = Math.max(0, Number(body.discount) || 0); const tax = Math.max(0, Number(body.tax) || 0); const shipping = Math.max(0, Number(body.shipping) || 0); const total = Math.max(0, subtotal + tax + shipping - discount);
    const db = await financeDb(); const now = new Date(); const quoteNumber = await nextDocumentNumber("COT", "Quote", "quoteNumber");
    const document = { quoteNumber, userId: oid(session.id), clientId: validObjectId(body.clientId) ? oid(body.clientId) : null, status: "draft", subtotal, tax, shipping, discount, total, notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : null, validUntil: body.validUntil ? new Date(body.validUntil) : null, items, createdAt: now, updatedAt: now, createdBy: oid(session.id) };
    const result = await db.collection("Quote").insertOne(document);
    await writeAuditLog({ userId: session.id, action: "QUOTE_CREATED", entityType: "Quote", entityId: result.insertedId.toHexString(), details: { quoteNumber, total, itemCount: items.length } });
    return NextResponse.json(jsonSafe({ ...document, _id: result.insertedId }), { status: 201 });
  } catch (error) {
    console.error("POST /api/quotes", error);
    return NextResponse.json({ error: "No se pudo crear la cotización" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json(); if (!validObjectId(body.id)) return NextResponse.json({ error: "Cotización inválida" }, { status: 400 });
    const db = await financeDb(); const status = ["draft", "sent", "accepted", "rejected", "expired"].includes(body.status) ? body.status : null;
    if (!status) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    const result = await db.collection("Quote").updateOne({ _id: oid(body.id), userId: oid(session.id) }, { $set: { status, updatedAt: new Date() } });
    if (!result.matchedCount) return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 });
    return NextResponse.json({ ok: true, status });
  } catch { return NextResponse.json({ error: "No se pudo actualizar la cotización" }, { status: 500 }); }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json(); if (!validObjectId(body.id)) return NextResponse.json({ error: "Cotización inválida" }, { status: 400 });
    const db = await financeDb(); const quote = await db.collection("Quote").findOne({ _id: oid(body.id), userId: oid(session.id) });
    if (!quote) return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 });
    if (["converted", "rejected", "expired"].includes(quote.status)) return NextResponse.json({ error: "La cotización ya no puede convertirse" }, { status: 409 });
    const items = Array.isArray(quote.items) ? quote.items.map((i: any) => ({ productId: i.productId.toHexString(), quantity: Number(i.quantity) })) : [];
    const order = await createOrder({ items, clientId: quote.clientId?.toHexString?.() ?? null, discount: Number(quote.discount || 0), tax: Number(quote.tax || 0), shipping: Number(quote.shipping || 0), notes: `Convertida desde ${quote.quoteNumber}` } as any, { storeOwnerUserId: session.id, createdByUserId: session.id, clientId: quote.clientId?.toHexString?.() ?? null });
    await db.collection("Quote").updateOne({ _id: quote._id }, { $set: { status: "converted", convertedAt: new Date(), orderId: oid(order.id), updatedAt: new Date() } });
    await writeAuditLog({ userId: session.id, action: "QUOTE_CONVERTED", entityType: "Quote", entityId: quote._id.toHexString(), details: { quoteNumber: quote.quoteNumber, orderId: order.id, orderNumber: order.orderNumber } });
    return NextResponse.json({ quoteId: quote._id.toHexString(), order });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as any).status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo convertir la cotización" }, { status });
  }
}
