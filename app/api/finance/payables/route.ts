import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { financeDb, jsonSafe, oid, validObjectId } from "@/lib/finance/financial-ledger";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";
import { ensureSupplierPayableIndexes } from "@/lib/finance/supplier-payables";

const ROLES = ["admin", "user", "retailer"];
const METHODS = ["cash", "card", "transfer", "other"];

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = await financeDb();
  await ensureSupplierPayableIndexes();
  const p = request.nextUrl.searchParams;
  const supplierId = p.get("supplierId");
  const includePaid = p.get("includePaid") === "true";
  const filter: any = { userId: oid(session.id) };
  if (validObjectId(supplierId)) filter.supplierId = oid(supplierId!);
  if (!includePaid) filter.status = { $in: ["open", "partial"] };
  const rows = await db.collection("SupplierAccountPayable").find(filter).sort({ dueDate: 1 }).limit(500).toArray();
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
    await ensureSupplierPayableIndexes();
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
    const method = METHODS.includes(body.paymentMethod) ? body.paymentMethod : "cash";
    const db = await financeDb();
    await ensureSupplierPayableIndexes();
    const payableId = oid(body.id);
    const now = new Date();

    const updated = await db.collection("SupplierAccountPayable").findOneAndUpdate(
      { _id: payableId, userId: oid(session.id), status: { $in: ["open", "partial"] }, amountDue: { $gte: amount } },
      [
        { $set: { amountPaid: { $add: [{ $ifNull: ["$amountPaid", 0] }, amount] }, amountDue: { $max: [0, { $subtract: [{ $ifNull: ["$amountDue", 0] }, amount] }] }, updatedAt: now } },
        { $set: { status: { $cond: [{ $lte: ["$amountDue", 0.0001] }, "paid", "partial"] } } },
      ],
      { returnDocument: "after" },
    );
    if (!updated.value) {
      const existing = await db.collection("SupplierAccountPayable").findOne({ _id: payableId, userId: oid(session.id) });
      if (!existing) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
      return NextResponse.json({ error: "El pago supera el saldo pendiente" }, { status: 409 });
    }

    let cashMovement;
    try {
      cashMovement = await prisma.cashMovement.create({
        data: { type: "expense", source: "supplier_payment", amount, paymentMethod: method, userId: session.id, createdBy: session.id, description: `Pago proveedor ${updated.value.supplierName}${updated.value.reference ? ` · ${updated.value.reference}` : ""}`, status: "active", createdAt: now },
      });
    } catch (cashError) {
      await db.collection("SupplierAccountPayable").updateOne({ _id: payableId, userId: oid(session.id) }, { $inc: { amountPaid: -amount, amountDue: amount }, $set: { status: Number(updated.value.amountPaid ?? 0) - amount <= 0.0001 ? "open" : "partial", updatedAt: new Date() } });
      throw cashError;
    }

    let payment;
    try {
      payment = await db.collection("SupplierPayment").insertOne({ payableId, purchaseOrderId: updated.value.purchaseOrderId ?? null, userId: oid(session.id), supplierId: updated.value.supplierId, amount, paymentMethod: method, cashMovementId: oid(cashMovement.id), createdAt: now, createdBy: oid(session.id) });
    } catch (paymentError) {
      await prisma.cashMovement.update({ where: { id: cashMovement.id }, data: { status: "voided", voidedAt: new Date(), voidedBy: session.id, voidReason: "Compensación por fallo al registrar pago de proveedor" } });
      await db.collection("SupplierAccountPayable").updateOne({ _id: payableId, userId: oid(session.id) }, { $inc: { amountPaid: -amount, amountDue: amount }, $set: { status: Number(updated.value.amountPaid ?? 0) - amount <= 0.0001 ? "open" : "partial", updatedAt: new Date() } });
      throw paymentError;
    }

    await writeAuditLog({ userId: session.id, action: "AP_PAYMENT_RECORDED", entityType: "SupplierAccountPayable", entityId: body.id, details: { paymentId: payment.insertedId.toHexString(), cashMovementId: cashMovement.id, purchaseOrderId: updated.value.purchaseOrderId?.toHexString?.() ?? null, amount, paymentMethod: method, remaining: updated.value.amountDue } });
    return NextResponse.json({ ok: true, paymentId: payment.insertedId.toHexString(), cashMovementId: cashMovement.id, amountPaid: updated.value.amountPaid, amountDue: updated.value.amountDue, status: updated.value.status });
  } catch (error) {
    console.error("PATCH /api/finance/payables", error);
    return NextResponse.json({ error: "No se pudo registrar el pago" }, { status: 500 });
  }
}
