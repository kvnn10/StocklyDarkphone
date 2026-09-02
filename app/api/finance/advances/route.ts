import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { financeDb, jsonSafe, oid, validObjectId } from "@/lib/finance/financial-ledger";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const ROLES = ["admin", "user", "retailer"];
const METHODS = ["cash", "card", "transfer", "other"];
const TYPES = ["customer", "supplier"] as const;
type AdvanceType = (typeof TYPES)[number];

async function prepare(db: any) {
  await db.collection("FinanceAdvance").createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } });
  await db.collection("FinanceAdvance").createIndex({ userId: 1, type: 1, partyId: 1, status: 1, createdAt: -1 });
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = await financeDb();
  await prepare(db);
  const p = request.nextUrl.searchParams;
  const type = TYPES.includes(p.get("type") as AdvanceType) ? p.get("type") as AdvanceType : null;
  const filter: any = { userId: oid(session.id), status: { $in: ["open", "partial"] } };
  if (type) filter.type = type;
  if (validObjectId(p.get("partyId"))) filter.partyId = oid(p.get("partyId")!);
  const rows = await db.collection("FinanceAdvance").find(filter).sort({ createdAt: -1 }).limit(500).toArray();
  return NextResponse.json(rows.map(jsonSafe));
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const type = body.type as AdvanceType;
    if (!TYPES.includes(type)) return NextResponse.json({ error: "Tipo de anticipo inválido" }, { status: 400 });
    if (!validObjectId(body.partyId)) return NextResponse.json({ error: "Tercero inválido" }, { status: 400 });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El anticipo debe ser mayor que cero" }, { status: 400 });
    const method = METHODS.includes(body.paymentMethod) ? body.paymentMethod : "cash";
    const db = await financeDb();
    await prepare(db);
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim() ? body.idempotencyKey.trim().slice(0, 120) : null;
    if (idempotencyKey) {
      const existing = await db.collection("FinanceAdvance").findOne({ userId: oid(session.id), idempotencyKey });
      if (existing) return NextResponse.json(jsonSafe(existing));
    }

    let partyName = "";
    if (type === "supplier") {
      const supplier = await prisma.supplier.findFirst({ where: { id: body.partyId, userId: session.id } });
      if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
      partyName = supplier.name;
    } else {
      const client = await prisma.user.findFirst({ where: { id: body.partyId, role: "client" } });
      if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
      partyName = client.name;
    }

    const now = new Date();
    const document = { userId: oid(session.id), type, partyId: oid(body.partyId), partyName, originalAmount: amount, amountApplied: 0, amountAvailable: amount, status: "open", paymentMethod: method, reference: typeof body.reference === "string" ? body.reference.trim().slice(0, 100) : null, notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 300) : null, idempotencyKey, createdAt: now, updatedAt: now, createdBy: oid(session.id) };
    const result = await db.collection("FinanceAdvance").insertOne(document);
    let cashMovement;
    try {
      cashMovement = await prisma.cashMovement.create({ data: { type: type === "customer" ? "income" : "expense", source: type === "customer" ? "customer_advance" : "supplier_advance", amount, paymentMethod: method, userId: session.id, createdBy: session.id, description: `${type === "customer" ? "Anticipo cliente" : "Anticipo proveedor"} ${partyName}${document.reference ? ` · ${document.reference}` : ""}`, status: "active", createdAt: now } });
    } catch (cashError) {
      await db.collection("FinanceAdvance").deleteOne({ _id: result.insertedId, userId: oid(session.id) });
      throw cashError;
    }
    await db.collection("FinanceAdvance").updateOne({ _id: result.insertedId }, { $set: { cashMovementId: cashMovement.id } });
    await writeAuditLog({ userId: session.id, action: type === "customer" ? "CUSTOMER_ADVANCE_CREATED" : "SUPPLIER_ADVANCE_CREATED", entityType: "FinanceAdvance", entityId: result.insertedId.toHexString(), details: { type, partyId: body.partyId, amount, paymentMethod: method, cashMovementId: cashMovement.id } });
    return NextResponse.json(jsonSafe({ ...document, _id: result.insertedId, cashMovementId: cashMovement.id }), { status: 201 });
  } catch (error: any) {
    if (error?.code === 11000) return NextResponse.json({ error: "El anticipo ya fue registrado con esa clave" }, { status: 409 });
    console.error("POST /api/finance/advances", error);
    return NextResponse.json({ error: "No se pudo registrar el anticipo" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!validObjectId(body.id) || !validObjectId(body.targetId)) return NextResponse.json({ error: "Anticipo o cuenta destino inválida" }, { status: 400 });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El valor aplicado debe ser mayor que cero" }, { status: 400 });
    const db = await financeDb();
    await prepare(db);
    const advance = await db.collection("FinanceAdvance").findOne({ _id: oid(body.id), userId: oid(session.id), status: { $in: ["open", "partial"] } });
    if (!advance) return NextResponse.json({ error: "Anticipo no encontrado" }, { status: 404 });
    if (amount > Number(advance.amountAvailable ?? 0) + 0.0001) return NextResponse.json({ error: "El valor supera el saldo disponible del anticipo" }, { status: 409 });

    const isCustomer = advance.type === "customer";
    const collection = isCustomer ? "AccountReceivable" : "SupplierAccountPayable";
    const target = await db.collection(collection).findOne({ _id: oid(body.targetId), userId: oid(session.id), ...(isCustomer ? { clientId: advance.partyId } : { supplierId: advance.partyId }), status: { $in: ["open", "partial"] } });
    if (!target) return NextResponse.json({ error: "Cuenta destino no encontrada o no pertenece al tercero" }, { status: 404 });
    if (amount > Number(target.amountDue ?? 0) + 0.0001) return NextResponse.json({ error: "El valor supera el saldo de la cuenta destino" }, { status: 409 });

    const now = new Date();
    const nextDue = Math.max(0, Number(target.amountDue) - amount);
    const targetUpdate = isCustomer
      ? { $set: { amountPaid: Number(target.amountPaid ?? 0) + amount, amountDue: nextDue, status: nextDue <= 0.0001 ? "paid" : "partial", updatedAt: now } }
      : { $set: { amountPaid: Number(target.amountPaid ?? 0) + amount, amountDue: nextDue, status: nextDue <= 0.0001 ? "paid" : "partial", updatedAt: now } };
    await db.collection(collection).updateOne({ _id: target._id, userId: oid(session.id), amountDue: { $gte: amount } }, targetUpdate);

    const advanceUpdate = await db.collection("FinanceAdvance").findOneAndUpdate(
      { _id: advance._id, userId: oid(session.id), status: { $in: ["open", "partial"] }, amountAvailable: { $gte: amount } },
      [
        { $set: { amountApplied: { $add: [{ $ifNull: ["$amountApplied", 0] }, amount] }, amountAvailable: { $max: [0, { $subtract: [{ $ifNull: ["$amountAvailable", 0] }, amount] }] }, updatedAt: now } },
        { $set: { status: { $cond: [{ $lte: ["$amountAvailable", 0.0001] }, "applied", "partial"] } } },
      ],
      { returnDocument: "after" },
    );
    if (!advanceUpdate.value) {
      await db.collection(collection).updateOne({ _id: target._id, userId: oid(session.id) }, { $set: { amountPaid: target.amountPaid, amountDue: target.amountDue, status: target.status, updatedAt: new Date() } });
      return NextResponse.json({ error: "El anticipo ya no tiene saldo suficiente; operación revertida" }, { status: 409 });
    }

    const paymentDoc = isCustomer
      ? { receivableId: target._id, advanceId: advance._id, userId: oid(session.id), amount, paymentMethod: "advance", createdAt: now, createdBy: oid(session.id) }
      : { payableId: target._id, advanceId: advance._id, purchaseOrderId: target.purchaseOrderId ?? null, userId: oid(session.id), supplierId: target.supplierId, amount, paymentMethod: "advance", createdAt: now, createdBy: oid(session.id) };
    await db.collection(isCustomer ? "AccountReceivablePayment" : "SupplierPayment").insertOne(paymentDoc);
    await writeAuditLog({ userId: session.id, action: isCustomer ? "CUSTOMER_ADVANCE_APPLIED" : "SUPPLIER_ADVANCE_APPLIED", entityType: "FinanceAdvance", entityId: body.id, details: { targetId: body.targetId, amount, remainingAdvance: advanceUpdate.value.amountAvailable, remainingTarget: nextDue } });
    return NextResponse.json(jsonSafe({ ok: true, advance: advanceUpdate.value, targetId: body.targetId, amountApplied: amount, targetAmountDue: nextDue }));
  } catch (error) {
    console.error("PATCH /api/finance/advances", error);
    return NextResponse.json({ error: "No se pudo aplicar el anticipo" }, { status: 500 });
  }
}
