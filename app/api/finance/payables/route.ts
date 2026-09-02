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
  const rows = await db.collection("SupplierAccountPayable").find({ userId: oid(session.id), status: { $in: ["open", "partial"] } }).sort({ dueDate: 1 }).limit(500).toArray();
  return NextResponse.json(rows.map(jsonSafe));
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!validObjectId(body.supplierId)) return NextResponse.json({ error: "Proveedor inválido" }, { status: 400 });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El saldo debe ser mayor que cero" }, { status: 400 });
    const supplier = await prisma.supplier.findFirst({ where: { id: body.supplierId, userId: session.id } });
    if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
    const db = await financeDb();
    const now = new Date();
    const document = { userId: oid(session.id), supplierId: oid(supplier.id), supplierName: supplier.name, reference: typeof body.reference === "string" ? body.reference.trim().slice(0, 100) : null, originalAmount: amount, amountPaid: 0, amountDue: amount, status: "open", dueDate: body.dueDate ? new Date(body.dueDate) : now, notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 300) : null, createdAt: now, updatedAt: now, createdBy: oid(session.id) };
    const result = await db.collection("SupplierAccountPayable").insertOne(document);
    await writeAuditLog({ userId: session.id, action: "AP_CREATED", entityType: "SupplierAccountPayable", entityId: result.insertedId.toHexString(), details: { supplierId: supplier.id, amount, reference: document.reference } });
    return NextResponse.json(jsonSafe({ ...document, _id: result.insertedId }), { status: 201 });
  } catch (error) {
    console.error("POST /api/finance/payables", error);
    return NextResponse.json({ error: "No se pudo crear la cuenta por pagar" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!validObjectId(body.id)) return NextResponse.json({ error: "Cuenta inválida" }, { status: 400 });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El pago debe ser mayor que cero" }, { status: 400 });
    const db = await financeDb();
    const ap = await db.collection("SupplierAccountPayable").findOne({ _id: oid(body.id), userId: oid(session.id), status: { $in: ["open", "partial"] } });
    if (!ap) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    if (amount > Number(ap.amountDue) + 0.0001) return NextResponse.json({ error: "El pago supera el saldo pendiente" }, { status: 409 });
    const method = ["cash", "card", "transfer", "other"].includes(body.paymentMethod) ? body.paymentMethod : "cash";
    const now = new Date();
    const payment = await db.collection("SupplierPayment").insertOne({ payableId: ap._id, userId: oid(session.id), amount, paymentMethod: method, createdAt: now, createdBy: oid(session.id) });
    const nextPaid = Number(ap.amountPaid) + amount;
    const nextDue = Math.max(0, Number(ap.amountDue) - amount);
    await db.collection("SupplierAccountPayable").updateOne({ _id: ap._id }, { $set: { amountPaid: nextPaid, amountDue: nextDue, status: nextDue <= 0.0001 ? "paid" : "partial", updatedAt: now } });
    await prisma.cashMovement.create({ data: { type: "expense", source: "manual", amount, paymentMethod: method, userId: session.id, createdBy: session.id, description: `Pago proveedor ${ap.supplierName}`, status: "active", createdAt: now } });
    await writeAuditLog({ userId: session.id, action: "AP_PAYMENT_RECORDED", entityType: "SupplierAccountPayable", entityId: body.id, details: { paymentId: payment.insertedId.toHexString(), amount, paymentMethod: method, remaining: nextDue } });
    return NextResponse.json({ ok: true, amountPaid: nextPaid, amountDue: nextDue, status: nextDue <= 0.0001 ? "paid" : "partial" });
  } catch (error) {
    console.error("PATCH /api/finance/payables", error);
    return NextResponse.json({ error: "No se pudo registrar el pago" }, { status: 500 });
  }
}
