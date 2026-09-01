import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";

const n = (v: unknown) => Number(v ?? 0);
const finiteNonNegative = (v: unknown) => {
  const value = n(v);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const orders = await prisma.purchaseOrder.findMany({ where: { userId: session.id }, orderBy: { createdAt: "desc" }, include: { items: true } });
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
  const items: Array<{ productId: string; productName: string; sku: string | null; orderedQuantity: number; receivedQuantity: number; unitCost: number; subtotal: number }> = [];
  for (const item of body.items) {
    const p = byId.get(item.productId);
    if (!p) return NextResponse.json({ error: `Producto no encontrado: ${item.productId}` }, { status: 400 });
    const quantity = finiteNonNegative(item.quantity);
    const unitCost = finiteNonNegative(item.unitCost);
    if (quantity === null || !Number.isInteger(quantity) || quantity < 1) return NextResponse.json({ error: `Cantidad inválida para el producto: ${p.name}` }, { status: 400 });
    if (unitCost === null) return NextResponse.json({ error: `Costo unitario inválido para el producto: ${p.name}` }, { status: 400 });
    items.push({ productId: p.id, productName: p.name, sku: p.sku, orderedQuantity: quantity, receivedQuantity: 0, unitCost, subtotal: quantity * unitCost });
  }
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const shipping = finiteNonNegative(body.shipping);
  const tax = finiteNonNegative(body.tax);
  if (shipping === null || tax === null) return NextResponse.json({ error: "Envío e impuestos deben ser valores numéricos válidos" }, { status: 400 });
  const total = subtotal + shipping + tax;
  const purchaseNumber = `OC-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
  const order = await prisma.purchaseOrder.create({ data: { purchaseNumber, supplierId: supplier.id, userId: session.id, status: "draft", subtotal, shipping, tax, total, notes: body.notes || null, createdBy: session.id, items: { create: items } }, include: { items: true } });
  return NextResponse.json(order, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json();
  const order = await prisma.purchaseOrder.findFirst({ where: { id: body.id, userId: session.id }, include: { items: true } });
  if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  if (["received", "cancelled"].includes(order.status)) return NextResponse.json({ error: "La orden ya está cerrada" }, { status: 409 });
  if (body.status === "cancelled") {
    if (order.status !== "draft") return NextResponse.json({ error: "No se puede cancelar una orden que ya tiene mercancía recibida. Gestiona una devolución del inventario recibido." }, { status: 409 });
    const updated = await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "cancelled", updatedAt: new Date(), updatedBy: session.id }, include: { items: true } });
    return NextResponse.json(updated);
  }
  if (body.status !== "received") return NextResponse.json({ error: "Solo se puede marcar como recibida" }, { status: 400 });

  const requested = Array.isArray(body.items) ? body.items : order.items.map((i) => ({ id: i.id, quantity: i.orderedQuantity - i.receivedQuantity }));
  const receivedMap = new Map<string, number>(requested.map((i: any) => [String(i.id), Math.max(0, Math.floor(n(i.quantity)))]));
  const warehouseId = typeof body.warehouseId === "string" ? body.warehouseId : "";
  if (!warehouseId) return NextResponse.json({ error: "Selecciona la bodega donde recibir la mercancía" }, { status: 400 });
  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, userId: session.id, status: true }, select: { id: true, name: true } });
  if (!warehouse) return NextResponse.json({ error: "Bodega no encontrada o inactiva" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    let allReceived = true;
    for (const item of order.items) {
      const remaining = Math.max(0, item.orderedQuantity - item.receivedQuantity);
      const qty = Math.min(remaining, receivedMap.get(String(item.id)) ?? 0);
      if (qty <= 0) {
        if (remaining > 0) allReceived = false;
        continue;
      }
      const product = await tx.product.findFirst({ where: { id: item.productId, userId: session.id, deletedAt: null } });
      if (!product) throw new Error(`Producto no encontrado: ${item.productName}`);
      const oldGlobalQty = n(product.quantity);
      const oldCost = n(product.purchasePrice);
      const newGlobalQty = oldGlobalQty + qty;
      const weightedCost = newGlobalQty > 0 ? ((oldGlobalQty * oldCost) + (qty * item.unitCost)) / newGlobalQty : item.unitCost;
      const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } } });
      const previousWarehouseStock = allocation?.quantity ?? 0n;
      const newWarehouseStock = previousWarehouseStock + BigInt(qty);
      if (allocation) await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: newWarehouseStock, updatedAt: new Date() } });
      else await tx.stockAllocation.create({ data: { productId: product.id, warehouseId: warehouse.id, userId: session.id, quantity: newWarehouseStock, reservedQuantity: 0n, createdAt: new Date() } });
      const allocations = await tx.stockAllocation.findMany({ where: { productId: product.id }, select: { quantity: true } });
      const totalStock = allocations.reduce((sum, row) => sum + row.quantity, 0n);
      await tx.product.update({ where: { id: product.id }, data: { quantity: totalStock, purchasePrice: weightedCost, updatedAt: new Date(), updatedBy: session.id } });
      const nextReceived = item.receivedQuantity + qty;
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: nextReceived } });
      await tx.inventoryMovement.create({ data: { productId: product.id, warehouseId: warehouse.id, userId: session.id, type: "entry", quantity: BigInt(qty), previousStock: previousWarehouseStock, newStock: newWarehouseStock, reason: "Recepción de compra", referenceId: order.id, notes: `${order.purchaseNumber} · ${item.productName}` } });
      if (nextReceived < item.orderedQuantity) allReceived = false;
    }
    return tx.purchaseOrder.update({ where: { id: order.id }, data: { status: allReceived ? "received" : "partial", receivedAt: allReceived ? new Date() : order.receivedAt, updatedAt: new Date(), updatedBy: session.id }, include: { items: true } });
  });
  return NextResponse.json(result);
}
