import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const ROLES = ["admin", "user", "retailer"] as const;
const round = (value: number) => Math.round(value * 100) / 100;

function parseDate(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const from = parseDate(request.nextUrl.searchParams.get("from"), monthStart);
    const to = parseDate(request.nextUrl.searchParams.get("to"), now);
    if (from > to) {
      return NextResponse.json({ error: "El rango de fechas es inválido" }, { status: 400 });
    }

    const dateWhere = { gte: from, lte: to };
    const baseOrderWhere = { userId: session.id };
    const baseServiceWhere = { userId: session.id };

    const [
      salePayments,
      servicePayments,
      cashMovements,
      orders,
      serviceOrders,
    ] = await Promise.all([
      prisma.salePayment.findMany({
        where: { ...baseOrderWhere, createdAt: dateWhere, status: "paid" },
        select: { amount: true, paymentMethod: true, orderId: true, orderNumber: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.serviceOrderPayment.findMany({
        where: { ...baseServiceWhere, createdAt: dateWhere, status: "paid" },
        select: { amount: true, paymentMethod: true, serviceOrderId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.cashMovement.findMany({
        where: { userId: session.id, createdAt: dateWhere },
        select: {
          id: true,
          type: true,
          source: true,
          amount: true,
          paymentMethod: true,
          orderId: true,
          orderNumber: true,
          status: true,
          description: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.order.findMany({
        where: { ...baseOrderWhere, createdAt: dateWhere },
        select: {
          id: true,
          orderNumber: true,
          total: true,
          amountPaid: false,
          paymentStatus: true,
          status: true,
          items: { select: { quantity: true, purchasePrice: true } },
        },
      }),
      prisma.serviceOrder.findMany({
        where: { ...baseServiceWhere, createdAt: dateWhere },
        select: {
          id: true,
          orderNumber: true,
          total: true,
          amountPaid: true,
          amountDue: true,
          status: true,
          items: { select: { quantity: true, unitCost: true } },
        },
      }),
    ]);

    const activeCash = cashMovements.filter((m) => m.status !== "voided");
    const cashIncome = activeCash.filter((m) => m.type === "income").reduce((sum, m) => sum + Number(m.amount || 0), 0);
    const cashExpense = activeCash.filter((m) => m.type === "expense").reduce((sum, m) => sum + Number(m.amount || 0), 0);

    const salesCollected = salePayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const repairsCollected = servicePayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const paymentsCollected = salesCollected + repairsCollected;

    const salesRevenue = orders.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + Number(o.total || 0), 0);
    const salesDue = orders.filter((o) => o.status !== "cancelled").reduce((sum, o) => {
      const paid = salePayments.filter((p) => p.orderId === o.id).reduce((s, p) => s + Number(p.amount || 0), 0);
      return sum + Math.max(0, Number(o.total || 0) - paid);
    }, 0);
    const repairRevenue = serviceOrders.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + Number(o.total || 0), 0);
    const repairDue = serviceOrders.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + Math.max(0, Number(o.amountDue || 0)), 0);

    const salesCost = orders.filter((o) => o.status !== "cancelled").reduce(
      (sum, o) => sum + o.items.reduce((itemSum, item) => itemSum + Number(item.purchasePrice || 0) * item.quantity, 0),
      0,
    );
    const repairCost = serviceOrders.filter((o) => o.status !== "cancelled").reduce(
      (sum, o) => sum + o.items.reduce((itemSum, item) => itemSum + Number(item.unitCost || 0) * item.quantity, 0),
      0,
    );

    const byMethod = new Map<string, number>();
    for (const payment of [...salePayments, ...servicePayments]) {
      byMethod.set(payment.paymentMethod, (byMethod.get(payment.paymentMethod) ?? 0) + Number(payment.amount || 0));
    }

    const cashByMethod = new Map<string, number>();
    for (const movement of activeCash.filter((m) => m.type === "income")) {
      cashByMethod.set(movement.paymentMethod, (cashByMethod.get(movement.paymentMethod) ?? 0) + Number(movement.amount || 0));
    }

    const result = {
      period: { from: from.toISOString(), to: to.toISOString() },
      revenue: {
        sales: round(salesRevenue),
        repairs: round(repairRevenue),
        total: round(salesRevenue + repairRevenue),
      },
      collected: {
        sales: round(salesCollected),
        repairs: round(repairsCollected),
        total: round(paymentsCollected),
      },
      receivables: {
        sales: round(salesDue),
        repairs: round(repairDue),
        total: round(salesDue + repairDue),
      },
      grossProfit: {
        sales: round(salesRevenue - salesCost),
        repairs: round(repairRevenue - repairCost),
        total: round(salesRevenue + repairRevenue - salesCost - repairCost),
        margin: salesRevenue + repairRevenue > 0
          ? round(((salesRevenue + repairRevenue - salesCost - repairCost) / (salesRevenue + repairRevenue)) * 100)
          : 0,
      },
      cash: {
        income: round(cashIncome),
        expense: round(cashExpense),
        balance: round(cashIncome - cashExpense),
        paymentMovementDifference: round(cashIncome - paymentsCollected),
      },
      paymentsByMethod: Object.fromEntries([...byMethod.entries()].map(([method, amount]) => [method, round(amount)])),
      cashIncomeByMethod: Object.fromEntries([...cashByMethod.entries()].map(([method, amount]) => [method, round(amount)])),
      counts: {
        sales: orders.filter((o) => o.status !== "cancelled").length,
        repairs: serviceOrders.filter((o) => o.status !== "cancelled").length,
        salePayments: salePayments.length,
        repairPayments: servicePayments.length,
        cashMovements: activeCash.length,
      },
      reconciliation: {
        status: Math.abs(cashIncome - paymentsCollected) < 0.01 ? "balanced" : "attention",
        difference: round(cashIncome - paymentsCollected),
      },
      recentCashMovements: activeCash.slice(0, 20).map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
      })),
    };

    await writeAuditLog({
      userId: session.id,
      action: "FINANCE_REPORT_VIEWED",
      entityType: "FinanceReport",
      details: {
        from: from.toISOString(),
        to: to.toISOString(),
        collected: result.collected.total,
        grossProfit: result.grossProfit.total,
        cashBalance: result.cash.balance,
        reconciliationStatus: result.reconciliation.status,
      },
      userAgent: request.headers.get("user-agent"),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip"),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/reports/finance", error);
    return NextResponse.json({ error: "No se pudo generar el resumen financiero" }, { status: 500 });
  }
}
