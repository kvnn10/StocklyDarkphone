import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";
import { financeDb, jsonSafe, nextDocumentNumber, oid } from "@/lib/finance/financial-ledger";

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, "finance", "read");
  if (auth.response) return auth.response;
  const db = await financeDb();
  const rows = await db.collection("Expense").find({ userId: oid(auth.session!.id) }).sort({ createdAt: -1 }).limit(500).toArray();
  return NextResponse.json(rows.map(jsonSafe));
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, "finance", "manage_expenses");
  if (auth.response) return auth.response;
  const session = auth.session!;
  try {
    const body = await request.json();
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El gasto debe ser mayor que cero" }, { status: 400 });
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 300) : "";
    if (!description) return NextResponse.json({ error: "La descripción es obligatoria" }, { status: 400 });
    const paymentMethod = ["cash", "card", "transfer", "other"].includes(body.paymentMethod) ? body.paymentMethod : "cash";
    const db = await financeDb();
    const now = new Date();
    const expenseNumber = await nextDocumentNumber("EXP", "Expense", "expenseNumber");
    const expense = { expenseNumber, userId: oid(session.id), amount, description, category: typeof body.category === "string" ? body.category.trim().slice(0, 100) : "General", paymentMethod, status: "active", createdBy: oid(session.id), createdAt: now };
    const result = await db.collection("Expense").insertOne(expense);
    const movement = await prisma.cashMovement.create({ data: { type: "expense", source: "manual", amount, paymentMethod, userId: session.id, createdBy: session.id, description: `Gasto ${expenseNumber}: ${description}`, status: "active", createdAt: now } });
    await writeAuditLog({ userId: session.id, action: "EXPENSE_CREATED", entityType: "Expense", entityId: result.insertedId.toHexString(), details: { expenseNumber, amount, category: expense.category, paymentMethod, cashMovementId: movement.id } });
    return NextResponse.json(jsonSafe({ ...expense, _id: result.insertedId, cashMovementId: movement.id }), { status: 201 });
  } catch (error) {
    console.error("POST /api/finance/expenses", error);
    return NextResponse.json({ error: "No se pudo registrar el gasto" }, { status: 500 });
  }
}
