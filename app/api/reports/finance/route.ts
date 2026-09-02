import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const ROLES = ["admin", "user", "retailer"] as const;
const round = (value: number) => Math.round(value * 100) / 100;
function parseDate(value: string | null, fallback: Date) { if (!value) return fallback; const date = new Date(value); return Number.isNaN(date.getTime()) ? fallback : date; }

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as (typeof ROLES)[number])) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const from = parseDate(request.nextUrl.searchParams.get("from"), monthStart);
    const to = parseDate(request.nextUrl.searchParams.get("to"), now);
    if (from > to) return NextResponse.json({ error: "El rango de fechas es inválido" }, { status: 400 });
    const dateWhere = { gte: from, lte: to };
    const [salePayments, servicePayments, cashMovements, orders, serviceOrders] = await Promise.all([
      prisma.salePayment.findMany({ where: { userId: session.id, createdAt: dateWhere, status: "paid" }, select: { amount: true, paymentMethod: true, orderId: true, orderNumber: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
      prisma.serviceOrderPayment.findMany({ where: { userId: session.id, createdAt: dateWhere, status: "paid" }, select: { amount: true, paymentMethod: true, serviceOrderId: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
      prisma.cashMovement.findMany({ where: { userId: session.id, createdAt: dateWhere }, select: { id: true, type: true, source: true, amount: true, paymentMethod: true, orderId: true, orderNumber: true, status: true, description: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
      prisma.order.findMany({ where: { userId: session.id, createdAt: dateWhere }, select: { id: true, orderNumber: true, total: true, paymentStatus: true, status: true, items: { select: { quantity: true, purchasePrice: true } } } }),
      prisma.serviceOrder.findMany({ where: { userId: session.id, createdAt: dateWhere }, select: { id: true, orderNumber: true, total: true, amountPaid: true, amountDue: true, status: true, items: { select: { quantity: true, unitCost: true } } } }),
    ]);
    const activeCash = cashMovements.filter(m => m.status !== "voided");
    const cashIncome = activeCash.filter(m => m.type === "income").reduce((s,m) => s + Number(m.amount || 0), 0);
    const cashExpense = activeCash.filter(m => m.type === "expense").reduce((s,m) => s + Number(m.amount || 0), 0);
    const salesCollected = salePayments.reduce((s,p) => s + Number(p.amount || 0), 0);
    const repairsCollected = servicePayments.reduce((s,p) => s + Number(p.amount || 0), 0);
    const paymentsCollected = salesCollected + repairsCollected;
    const activeOrders = orders.filter(o => o.status !== "cancelled");
    const activeRepairs = serviceOrders.filter(o => o.status !== "cancelled");
    const salesRevenue = activeOrders.reduce((s,o) => s + Number(o.total || 0), 0);
    const salesDue = activeOrders.reduce((s,o) => { const paid = salePayments.filter(p => p.orderId === o.id).reduce((x,p) => x + Number(p.amount || 0), 0); return s + Math.max(0, Number(o.total || 0) - paid); }, 0);
    const repairRevenue = activeRepairs.reduce((s,o) => s + Number(o.total || 0), 0);
    const repairDue = activeRepairs.reduce((s,o) => s + Math.max(0, Number(o.amountDue || 0)), 0);
    const salesCost = activeOrders.reduce((s,o) => s + o.items.reduce((x,i) => x + Number(i.purchasePrice || 0) * i.quantity, 0), 0);
    const repairCost = activeRepairs.reduce((s,o) => s + o.items.reduce((x,i) => x + Number(i.unitCost || 0) * i.quantity, 0), 0);
    const byMethod = new Map<string, number>();
    for (const p of [...salePayments, ...servicePayments]) byMethod.set(p.paymentMethod, (byMethod.get(p.paymentMethod) ?? 0) + Number(p.amount || 0));
    const cashByMethod = new Map<string, number>();
    for (const m of activeCash.filter(m => m.type === "income")) cashByMethod.set(m.paymentMethod, (cashByMethod.get(m.paymentMethod) ?? 0) + Number(m.amount || 0));
    const result = {
      period: { from: from.toISOString(), to: to.toISOString() },
      revenue: { sales: round(salesRevenue), repairs: round(repairRevenue), total: round(salesRevenue + repairRevenue) },
      collected: { sales: round(salesCollected), repairs: round(repairsCollected), total: round(paymentsCollected) },
      receivables: { sales: round(salesDue), repairs: round(repairDue), total: round(salesDue + repairDue) },
      grossProfit: { sales: round(salesRevenue - salesCost), repairs: round(repairRevenue - repairCost), total: round(salesRevenue + repairRevenue - salesCost - repairCost), margin: salesRevenue + repairRevenue > 0 ? round(((salesRevenue + repairRevenue - salesCost - repairCost) / (salesRevenue + repairRevenue)) * 100) : 0 },
      cash: { income: round(cashIncome), expense: round(cashExpense), balance: round(cashIncome - cashExpense), paymentMovementDifference: round(cashIncome - paymentsCollected) },
      paymentsByMethod: Object.fromEntries([...byMethod.entries()].map(([k,v]) => [k, round(v)])),
      cashIncomeByMethod: Object.fromEntries([...cashByMethod.entries()].map(([k,v]) => [k, round(v)])),
      counts: { sales: activeOrders.length, repairs: activeRepairs.length, salePayments: salePayments.length, repairPayments: servicePayments.length, cashMovements: activeCash.length },
      reconciliation: { status: Math.abs(cashIncome - paymentsCollected) < 0.01 ? "balanced" : "attention", difference: round(cashIncome - paymentsCollected) },
      recentCashMovements: activeCash.slice(0,20).map(m => ({ ...m, createdAt: m.createdAt.toISOString() })),
    };
    await writeAuditLog({ userId: session.id, action: "FINANCE_REPORT_VIEWED", entityType: "FinanceReport", details: { from: from.toISOString(), to: to.toISOString(), collected: result.collected.total, grossProfit: result.grossProfit.total, cashBalance: result.cash.balance, reconciliationStatus: result.reconciliation.status }, userAgent: request.headers.get("user-agent"), ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip") });
    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/reports/finance", error);
    return NextResponse.json({ error: "No se pudo generar el resumen financiero" }, { status: 500 });
  }
}
