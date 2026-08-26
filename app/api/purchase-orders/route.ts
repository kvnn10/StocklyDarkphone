import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";

const n = (v: unknown) => Number(v ?? 0);

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const orders = await prisma.purchaseOrder.findMany({ where: { userId: session.id }, orderBy: { createdAt: "desc" }, include: { items: true, supplier: true } });
  return NextResponse.json(orders);
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json();
  if (!body.supplierId || !Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: "Proveedor y al menos un producto son obligatorios" }, { status: 400 });
  const supplier = await prisma.supplier.findFirst({ where: { id: body.supplierId, userId: session.id } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  const productIds = body.items.map((i: any) => i.productId).filter(Boolean);
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, userId: session.id, deletedAt: null } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = body.items.map((i: any) => {
    const p = byId.get(i.productId);
    if (!p) throw new Error(`Producto no encontrado: ${i.productId}`);
    const qty = Math.max(1, Math.floor(n(i.quantity)));
    const unitCost = Math.max(0, n(i.unitCost));
    return { productId: p.id, productName: p.name, sku: p.sku, orderedQuantity: qty, receivedQuantity: 0, unitCost, subtotal: qty * unitCost };
  });
  const subtotal = items.reduce((s: number, i: any) => s + i.subtotal, 0);
  const shipping = Math.max(0, n(body.shipping));
  const tax = Math.max(0, n(body.tax));
  const total = Math.max(0, subtotal + shipping + tax);
  const purchaseNumber = `OC-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
  const order = await prisma.purchaseOrder.create({ data: { purchaseNumber, supplierId: supplier.id, userId: session.id, status: "draft", subtotal, shipping, tax, total, notes: body.notes || null, createdBy: session.id, items: { create: items } }, include: { items: true, supplier: true } });
  return NextResponse.json(order, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json();
  const order = await prisma.purchaseOrder.findFirst({ where: { id: body.id, userId: session.id }, include: { items: true, supplier: true } });
  if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  if (["received", "cancelled"].includes(order.status)) return NextResponse.json({ error: "La orden ya está cerrada" }, { status: 409 });
  if (body.status === "cancelled") {
    const updated = await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "cancelled", updatedAt: new Date(), updatedBy: session.id }, include: { items: true, supplier: true } });
    return NextResponse.json(updated);
  }
  if (body.status !== "received") return NextResponse.json({ error: "Solo se puede marcar como recibida" }, { status: 400 });

  const requested = Array.isArray(body.items) ? body.items : order.items.map((i) => ({ id: i.id, quantity: i.orderedQuantity - i.receivedQuantity }));
  const receivedMap = new Map<string, number>(requested.map((i: any) => [String(i.id), Math.max(0, Math.floor(n(i.quantity)))]));
  const result = await prisma.$transaction(async (tx) => {
    let allReceived = true;
    for (const item of order.items) {
      const remaining = Math.max(0, item.orderedQuantity - item.receivedQuantity);
      const qty = Math.min(remaining, receivedMap.get(String(item.id)) ?? 0);
      if (qty <= 0) {
        if (remaining > 0) allReceived = false;
        continue;
      }
      const product = await tx.product.findFirst({ where: { id: item.productId, userId: session.id } });
      if (!product) throw new Error(`Producto no encontrado: ${item.productName}`);
      const oldQty = n(product.quantity);
      const oldCost = n(product.purchasePrice);
      const newQty = oldQty + qty;
      const weightedCost = newQty > 0 ? ((oldQty * oldCost) + (qty * item.unitCost)) / newQty : item.unitCost;
      await tx.product.update({ where: { id: product.id }, data: { quantity: BigInt(newQty), purchasePrice: weightedCost, updatedAt: new Date(), updatedBy: session.id } });
      const nextReceived = item.receivedQuantity + qty;
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: nextReceived } });
      if (nextReceived < item.orderedQuantity) allReceived = false;
    }
    return tx.purchaseOrder.update({ where: { id: order.id }, data: { status: allReceived ? "received" : "partial", receivedAt: allReceived ? new Date() : order.receivedAt, updatedAt: new Date(), updatedBy: session.id }, include: { items: true, supplier: true } });
  });
  return NextResponse.json(result);
}
