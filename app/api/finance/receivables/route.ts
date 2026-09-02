import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { financeDb, jsonSafe, oid, validObjectId } from "@/lib/finance/financial-ledger";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const ROLES = ["admin", "user", "retailer"];

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = await financeDb();
  const rows = await db.collection("AccountReceivable").find({ userId: oid(session.id), status: { $in: ["open", "partial"] } }).sort({ dueDate: 1 }).limit(500).toArray();
  return NextResponse.json(rows.map(jsonSafe));
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!validObjectId(body.orderId)) return NextResponse.json({ error: "Venta inválida" }, { status: 400 });
    const order = await prisma.order.findFirst({ where: { id: body.orderId, userId: session.id }, include: { invoice: true } });
    if (!order) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    const total = Number(order.total || 0);
    const paid = Number(order.invoice?.amountPaid ?? 0);
    const due = Math.max(0, total - paid);
    if (due <= 0) return NextResponse.json({ error: "La venta no tiene saldo pendiente" }, { status: 409 });
    const db = await financeDb();
    const now = new Date();
    const existing = await db.collection("AccountReceivable").findOne({ userId: oid(session.id), orderId: oid(order.id), status: { $in: ["open", "partial"] } });
    if (existing) return NextResponse.json(jsonSafe(existing));
    const document = { userId: oid(session.id), orderId: oid(order.id), orderNumber: order.orderNumber, clientId: order.clientId ? oid(order.clientId) : null, originalAmount: total, amountPaid: paid, amountDue: due, status: paid > 0 ? "partial" : "open", dueDate: order.invoice?.dueDate ?? now, createdAt: now, updatedAt: now, createdBy: oid(session.id) };
    const result = await db.collection("AccountReceivable").insertOne(document);
    await writeAuditLog({ userId: session.id, action: "AR_CREATED", entityType: "AccountReceivable", entityId: result.insertedId.toHexString(), details: { orderId: order.id, orderNumber: order.orderNumber, amountDue: due } });
    return NextResponse.json(jsonSafe({ ...document, _id: result.insertedId }), { status: 201 });
  } catch (error) {
    console.error("POST /api/finance/receivables", error);
    return NextResponse.json({ error: "No se pudo crear la cuenta por cobrar" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!validObjectId(body.id)) return NextResponse.json({ error: "Cuenta inválida" }, { status: 400 });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El abono debe ser mayor que cero" }, { status: 400 });
    const db = await financeDb();
    const ar = await db.collection("AccountReceivable").findOne({ _id: oid(body.id), userId: oid(session.id), status: { $in: ["open", "partial"] } });
    if (!ar) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    const due = Number(ar.amountDue);
    if (amount > due + 0.0001) return NextResponse.json({ error: "El abono supera el saldo pendiente" }, { status: 409 });
    const method = ["cash", "card", "transfer", "other"].includes(body.paymentMethod) ? body.paymentMethod : "cash";
    const now = new Date();
    const payment = await db.collection("AccountReceivablePayment").insertOne({ receivableId: ar._id, userId: oid(session.id), amount, paymentMethod: method, createdAt: now, createdBy: oid(session.id) });
    const nextPaid = Number(ar.amountPaid) + amount;
    const nextDue = Math.max(0, due - amount);
    await db.collection("AccountReceivable").updateOne({ _id: ar._id }, { $set: { amountPaid: nextPaid, amountDue: nextDue, status: nextDue <= 0.0001 ? "paid" : "partial", updatedAt: now } });
    await prisma.cashMovement.create({ data: { type: "income", source: "sale", amount, paymentMethod: method, orderId: ar.orderId.toHexString(), orderNumber: ar.orderNumber, userId: session.id, createdBy: session.id, description: `Abono cuenta por cobrar ${ar.orderNumber}`, status: "active", createdAt: now } });
    await writeAuditLog({ userId: session.id, action: "AR_PAYMENT_RECORDED", entityType: "AccountReceivable", entityId: body.id, details: { paymentId: payment.insertedId.toHexString(), amount, paymentMethod: method, remaining: nextDue } });
    return NextResponse.json({ ok: true, amountPaid: nextPaid, amountDue: nextDue, status: nextDue <= 0.0001 ? "paid" : "partial" });
  } catch (error) {
    console.error("PATCH /api/finance/receivables", error);
    return NextResponse.json({ error: "No se pudo registrar el abono" }, { status: 500 });
  }
}
