import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";
import { invalidateOnOrderChange } from "@/lib/cache";

const METHODS = new Set(["cash", "card", "transfer", "nequi", "daviplata", "other"]);
const FULFILLED_STATUSES = new Set(["confirmed", "processing", "shipped", "delivered"]);
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function adjustStock(tx: any, productId: string, quantity: number, warehouseId: string | null, direction: "in" | "out", userId: string, reason: string) {
  if (quantity <= 0) return;
  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, quantity: true, userId: true } });
  if (!product) throw new Error(`Producto no encontrado: ${productId}`);
  const previousProductStock = Number(product.quantity);
  const nextProductStock = direction === "in" ? previousProductStock + quantity : previousProductStock - quantity;
  if (nextProductStock < 0) throw new Error(`Stock insuficiente para ${productId}`);
  const productUpdate = await tx.product.updateMany({ where: { id: productId, quantity: product.quantity }, data: { quantity: direction === "in" ? { increment: quantity } : { decrement: quantity }, updatedAt: new Date() } });
  if (productUpdate.count !== 1) throw new Error("El stock cambió durante el cambio; vuelve a intentarlo");
  if (warehouseId) {
    const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId, warehouseId } }, select: { id: true, quantity: true, reservedQuantity: true, userId: true } });
    if (!allocation) throw new Error(`No existe stock de bodega para ${productId}`);
    const previous = allocation.quantity; const next = direction === "in" ? previous + BigInt(quantity) : previous - BigInt(quantity);
    if (next < 0n) throw new Error(`Stock insuficiente en bodega para ${productId}`);
    const result = await tx.stockAllocation.updateMany({ where: { id: allocation.id, quantity: allocation.quantity }, data: { quantity: direction === "in" ? { increment: quantity } : { decrement: quantity }, updatedAt: new Date() } });
    if (result.count !== 1) throw new Error("El stock de bodega cambió; vuelve a intentarlo");
    await tx.inventoryMovement.create({ data: { productId, warehouseId, userId: allocation.userId, type: direction === "in" ? "entry" : "exit", quantity: direction === "in" ? BigInt(quantity) : -BigInt(quantity), previousStock: previous, newStock: next, reason, referenceId: null, notes: "Cambio comercial de producto", createdAt: new Date() } });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Solo administradores pueden autorizar cambios de producto" }, { status: 403 });
  try {
    const { id } = await params; const body = await request.json();
    const originalItemId = String(body.originalItemId ?? ""); const replacementProductId = String(body.replacementProductId ?? "");
    const replacementWarehouseId = body.replacementWarehouseId ? String(body.replacementWarehouseId) : null;
    const replacementQuantity = Number(body.replacementQuantity ?? 0); const paymentMethod = String(body.paymentMethod ?? "other");
    const reason = String(body.reason ?? "Cambio de producto").trim().slice(0, 500); const idempotencyKey = String(body.idempotencyKey ?? "").trim();
    if (!originalItemId || !replacementProductId || !Number.isInteger(replacementQuantity) || replacementQuantity <= 0) return NextResponse.json({ error: "Datos del cambio inválidos" }, { status: 400 });
    if (!METHODS.has(paymentMethod)) return NextResponse.json({ error: "Método de pago inválido" }, { status: 400 });
    if (!idempotencyKey) return NextResponse.json({ error: "idempotencyKey es obligatorio" }, { status: 400 });
    const previousLogs = await prisma.auditLog.findMany({ where: { entityType: "Order", entityId: id, action: "ORDER_CHANGE" }, orderBy: { createdAt: "desc" }, take: 50 });
    const duplicate = previousLogs.find((log) => (log.details as Record<string, unknown> | null)?.idempotencyKey === idempotencyKey);
    if (duplicate) return NextResponse.json({ ok: true, duplicate: true, change: duplicate.details });

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id, userId: session.id }, include: { items: true } });
      if (!order) throw Object.assign(new Error("Venta no encontrada"), { status: 404 });
      if (order.status === "cancelled") throw Object.assign(new Error("No se puede cambiar una venta cancelada"), { status: 409 });
      if (!FULFILLED_STATUSES.has(order.status) && order.paymentStatus !== "paid" && order.paymentStatus !== "partial") throw Object.assign(new Error("La venta aún no está confirmada/facturada"), { status: 409 });
      const original = order.items.find((item) => item.id === originalItemId);
      if (!original) throw Object.assign(new Error("Producto original no encontrado en la venta"), { status: 404 });
      if (original.quantity < replacementQuantity) throw Object.assign(new Error("La cantidad de cambio no puede superar la cantidad vendida"), { status: 400 });
      const replacement = await tx.product.findFirst({ where: { id: replacementProductId, userId: session.id, deletedAt: null } });
      if (!replacement) throw Object.assign(new Error("Producto de reemplazo no encontrado"), { status: 404 });
      const originalTotal = money(Number(original.price) * replacementQuantity); const replacementTotal = money(Number(replacement.price) * replacementQuantity); const delta = money(replacementTotal - originalTotal);
      if (replacementProductId !== original.productId) {
        await adjustStock(tx, original.productId, replacementQuantity, original.warehouseId ?? null, "in", session.id, "Reintegro por cambio de producto");
        await adjustStock(tx, replacementProductId, replacementQuantity, replacementWarehouseId, "out", session.id, "Salida por cambio de producto");
      } else if (replacementWarehouseId !== (original.warehouseId ?? null)) {
        if (original.warehouseId) await adjustStock(tx, original.productId, replacementQuantity, original.warehouseId, "in", session.id, "Traslado por cambio de producto");
        if (replacementWarehouseId) await adjustStock(tx, replacementProductId, replacementQuantity, replacementWarehouseId, "out", session.id, "Traslado por cambio de producto");
      }
      const now = new Date(); const newSubtotal = money(Number(order.subtotal) + delta); const newTotal = money(Number(order.total) + delta);
      const payments = await tx.salePayment.findMany({ where: { orderId: order.id, status: "paid" } }); const paidBefore = money(payments.reduce((sum, p) => sum + Number(p.amount), 0));
      const invoice = await tx.invoice.findUnique({ where: { orderId: order.id } }); const invoicePaidBefore = money(Number(invoice?.amountPaid ?? 0)); const paid = Math.max(paidBefore, invoicePaidBefore);
      let paidAfter = paid; let dueAfter = money(Math.max(0, newTotal - paid)); let financialAction: "none" | "charge" | "refund" = "none";
      if (delta > 0) {
        financialAction = "charge";
        await tx.salePayment.create({ data: { orderId: order.id, orderNumber: order.orderNumber, userId: session.id, recordedBy: session.id, amount: delta, paymentMethod, status: "paid", createdAt: now } });
        await tx.cashMovement.create({ data: { type: "income", source: "change_charge", amount: delta, paymentMethod, orderId: order.id, orderNumber: order.orderNumber, userId: session.id, createdBy: session.id, description: `Cobro por cambio de ${order.orderNumber}`, status: "active", createdAt: now } });
        paidAfter = money(paid + delta); dueAfter = money(Math.max(0, newTotal - paidAfter));
      } else if (delta < 0) {
        financialAction = "refund"; const refund = Math.abs(delta);
        if (refund > paid + 0.01) throw Object.assign(new Error("El reembolso supera el valor efectivamente pagado"), { status: 409 });
        await tx.salePayment.create({ data: { orderId: order.id, orderNumber: order.orderNumber, userId: session.id, recordedBy: session.id, amount: refund, paymentMethod, status: "refunded", createdAt: now } });
        await tx.cashMovement.create({ data: { type: "expense", source: "change_refund", amount: refund, paymentMethod, orderId: order.id, orderNumber: order.orderNumber, userId: session.id, createdBy: session.id, description: `Reembolso por cambio de ${order.orderNumber}`, status: "active", createdAt: now } });
        paidAfter = money(paid - refund); dueAfter = money(Math.max(0, newTotal - paidAfter));
      }
      await tx.orderItem.update({ where: { id: original.id }, data: { productId: replacement.id, productName: replacement.name, sku: replacement.sku, quantity: replacementQuantity, price: Number(replacement.price), purchasePrice: Number(replacement.purchasePrice ?? 0), subtotal: replacementTotal, warehouseId: replacementWarehouseId, warehouseName: null } });
      const nextPaymentStatus = dueAfter <= 0.01 ? "paid" : paidAfter > 0 ? "partial" : "unpaid";
      const updatedOrder = await tx.order.update({ where: { id: order.id }, data: { subtotal: newSubtotal, total: newTotal, paymentStatus: nextPaymentStatus, updatedAt: now, updatedBy: session.id } });
      if (invoice) await tx.invoice.update({ where: { id: invoice.id }, data: { subtotal: newSubtotal, total: newTotal, amountPaid: paidAfter, amountDue: dueAfter, status: nextPaymentStatus === "paid" ? "paid" : "sent", updatedAt: now, updatedBy: session.id, paidAt: nextPaymentStatus === "paid" ? now : null } });
      return { orderNumber: updatedOrder.orderNumber, originalProductId: original.productId, replacementProductId: replacement.id, quantity: replacementQuantity, originalTotal, replacementTotal, difference: delta, financialAction, chargeAmount: delta > 0 ? delta : 0, refundAmount: delta < 0 ? Math.abs(delta) : 0, paymentStatus: nextPaymentStatus, idempotencyKey, reason };
    });
    await writeAuditLog({ userId: session.id, action: "ORDER_CHANGE", entityType: "Order", entityId: id, details: result });
    await invalidateOnOrderChange();
    return NextResponse.json({ ok: true, change: result });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: number }).status) || 500 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo procesar el cambio" }, { status });
  }
}
