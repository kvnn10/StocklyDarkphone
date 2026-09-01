import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";

const allowed = (session: any) => !!session && ["admin", "user", "retailer"].includes(session.role ?? "");

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const status = new URL(request.url).searchParams.get("status")?.trim() || "";
    const orders = await prisma.serviceOrder.findMany({ where: { userId: session.id, ...(status ? { status } : {}) }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 1000 });
    const rows = orders.map(order => {
      const partsRevenue = order.items.reduce((sum, item) => sum + Math.max(0, Number(item.subtotal)), 0);
      const partsCost = order.items.reduce((sum, item) => sum + Math.max(0, Number(item.unitCost) * item.quantity), 0);
      const labor = Math.max(0, Number(order.laborAmount));
      const discount = Math.max(0, Number(order.discount));
      const revenue = Math.max(0, Number(order.total || partsRevenue + labor - discount));
      const grossProfit = revenue - partsCost;
      const margin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      return { id: order.id, orderNumber: order.orderNumber, customer: order.customerName ?? "", device: [order.brand, order.model].filter(Boolean).join(" "), status: order.status, revenue, partsRevenue, partsCost, labor, discount, grossProfit, margin, createdAt: order.createdAt };
    });
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const partsCost = rows.reduce((s, r) => s + r.partsCost, 0);
    const grossProfit = rows.reduce((s, r) => s + r.grossProfit, 0);
    const labor = rows.reduce((s, r) => s + r.labor, 0);
    const averageMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    return NextResponse.json({ summary: { orders: rows.length, revenue, partsCost, labor, grossProfit, averageMargin }, orders: rows.slice(0, 100), warning: null });
  } catch (error) {
    console.error("GET /api/service-orders/profitability", error);
    return NextResponse.json({ error: "No se pudo calcular la rentabilidad" }, { status: 500 });
  }
}
