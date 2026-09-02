import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { financeDb, oid, jsonSafe } from "@/lib/finance/financial-ledger";

const ROLES = ["admin", "user", "retailer"];

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const p = request.nextUrl.searchParams;
    const from = p.get("from") ? new Date(p.get("from")!) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = p.get("to") ? new Date(p.get("to")!) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return NextResponse.json({ error: "Rango de fechas inválido" }, { status: 400 });
    const movements = await prisma.cashMovement.findMany({ where: { userId: session.id, createdAt: { gte: from, lte: to }, status: "active" } });
    const income = movements.filter(m => m.type === "income").reduce((s,m) => s + Number(m.amount), 0);
    const expenses = movements.filter(m => m.type === "expense").reduce((s,m) => s + Number(m.amount), 0);
    const sales = movements.filter(m => m.source === "sale" && m.type === "income").reduce((s,m) => s + Number(m.amount), 0);
    const refunds = movements.filter(m => m.source === "refund").reduce((s,m) => s + Number(m.amount), 0);
    const db = await financeDb();
    const [receivables, payables, expenseRows] = await Promise.all([
      db.collection("AccountReceivable").find({ userId: oid(session.id), createdAt: { $lte: to } }).toArray(),
      db.collection("SupplierAccountPayable").find({ userId: oid(session.id), createdAt: { $lte: to } }).toArray(),
      db.collection("Expense").find({ userId: oid(session.id), createdAt: { $gte: from, $lte: to }, status: "active" }).toArray(),
    ]);
    const arOutstanding = receivables.reduce((s,r) => s + Math.max(0, Number(r.amountDue || 0)), 0);
    const apOutstanding = payables.reduce((s,r) => s + Math.max(0, Number(r.amountDue || 0)), 0);
    const explicitExpenses = expenseRows.reduce((s,e) => s + Number(e.amount || 0), 0);
    return NextResponse.json(jsonSafe({ period: { from, to }, cash: { income, expenses, balance: income - expenses, sales, refunds }, accounts: { receivableOutstanding: arOutstanding, payableOutstanding: apOutstanding }, expenses: { recorded: explicitExpenses }, netOperational: income - expenses, generatedAt: new Date() }));
  } catch (error) {
    console.error("GET /api/finance/report", error);
    return NextResponse.json({ error: "No se pudo generar el reporte financiero" }, { status: 500 });
  }
}
