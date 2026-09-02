import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { financeDb, jsonSafe, oid } from "@/lib/finance/financial-ledger";
import { writeAuditLog } from "@/lib/audit/log";

const ROLES = ["admin", "user", "retailer"];

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = await financeDb();
  const rows = await db.collection("CashClosure").find({ userId: oid(session.id) }).sort({ closedAt: -1 }).limit(100).toArray();
  return NextResponse.json(rows.map(jsonSafe));
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const countedCash = Number(body.countedCash);
    if (!Number.isFinite(countedCash) || countedCash < 0) return NextResponse.json({ error: "El efectivo contado no es válido" }, { status: 400 });
    const db = await financeDb();
    const last = await db.collection("CashClosure").find({ userId: oid(session.id) }).sort({ closedAt: -1 }).limit(1).next();
    const periodStart = last?.closedAt ?? new Date(0);
    const periodEnd = new Date();
    const movements = await prisma.cashMovement.findMany({ where: { userId: session.id, createdAt: { gt: periodStart, lte: periodEnd }, status: "active" } });
    if (last && movements.length === 0) {
      return NextResponse.json({ error: "La caja ya fue cerrada y no existen movimientos nuevos para realizar otro cierre" }, { status: 409 });
    }
    const expectedCash = movements.filter(m => m.paymentMethod === "cash").reduce((sum, m) => sum + (m.type === "expense" ? -Number(m.amount) : Number(m.amount)), 0);
    const difference = countedCash - expectedCash;
    const closure = { userId: oid(session.id), periodStart, periodEnd, expectedCash, countedCash, difference, movementCount: movements.length, status: Math.abs(difference) < 0.005 ? "balanced" : "difference", closedAt: periodEnd, closedBy: oid(session.id) };
    const result = await db.collection("CashClosure").insertOne(closure);
    await writeAuditLog({ userId: session.id, action: "CASH_CLOSURE_CREATED", entityType: "CashClosure", entityId: result.insertedId.toHexString(), details: { expectedCash, countedCash, difference, movementCount: movements.length } });
    return NextResponse.json(jsonSafe({ ...closure, _id: result.insertedId }), { status: 201 });
  } catch (error) {
    console.error("POST /api/finance/cash-closures", error);
    return NextResponse.json({ error: "No se pudo realizar el cierre de caja" }, { status: 500 });
  }
}
