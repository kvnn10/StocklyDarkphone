import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

function startOfDay(value: Date) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(value: Date) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

function money(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const params = new URL(request.url).searchParams;
    const rawFrom = params.get("from");
    const rawTo = params.get("to");
    const now = new Date();
    const from = rawFrom ? startOfDay(new Date(rawFrom)) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = rawTo ? endOfDay(new Date(rawTo)) : endOfDay(now);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return NextResponse.json({ error: "Rango de fechas inválido" }, { status: 400 });
    }

    const [orders, services] = await Promise.all([
      prisma.order.findMany({
        where: {
          userId: session.id,
          createdAt: { gte: from, lte: to },
          status: { not: "cancelled" },
        },
        include: { items: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.serviceOrder.findMany({
        where: {
          userId: session.id,
          createdAt: { gte: from, lte: to },
          status: { not: "cancelled" },
        },
        include: { items: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const sales = orders.map((order) => {
      const revenue = money(order.total);
      const cost = order.items.reduce((sum, item) => sum + money(item.purchasePrice) * item.quantity, 0);
      const profit = revenue - cost;
      return {
        id: order.id,
        number: order.orderNumber,
        date: order.createdAt,
        revenue,
        cost,
        profit,
        margin: revenue > 0 ? (profit / revenue) * 100 : 0,
        type: "sale" as const,
      };
    });

    const repairs = services.map((order) => {
      const partsCost = order.items.reduce((sum, item) => sum + money(item.unitCost) * item.quantity, 0);
      const revenue = money(order.total);
      const cost = partsCost;
      const profit = revenue - cost;
      return {
        id: order.id,
        number: order.orderNumber,
        date: order.createdAt,
        revenue,
        cost,
        profit,
        margin: revenue > 0 ? (profit / revenue) * 100 : 0,
        type: "repair" as const,
      };
    });

    const entries = [...sales, ...repairs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const revenue = entries.reduce((sum, item) => sum + item.revenue, 0);
    const cost = entries.reduce((sum, item) => sum + item.cost, 0);
    const profit = revenue - cost;

    await writeAuditLog({
      userId: session.id,
      action: "PROFIT_REPORT_VIEWED",
      entityType: "ProfitReport",
      details: { from: from.toISOString(), to: to.toISOString(), entries: entries.length },
    });

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        revenue,
        cost,
        profit,
        margin: revenue > 0 ? (profit / revenue) * 100 : 0,
        salesCount: sales.length,
        repairsCount: repairs.length,
      },
      entries,
    });
  } catch (error) {
    console.error("GET /api/reports/profit", error);
    return NextResponse.json({ error: "No se pudo generar el reporte de utilidad" }, { status: 500 });
  }
}
