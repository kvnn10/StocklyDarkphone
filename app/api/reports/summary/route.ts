import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { authorizeRequest } from "@/lib/security/authorize";

const n = (v: unknown) => Number(v ?? 0);
const dayKey = (value: Date) => value.toISOString().slice(0, 10);

export async function GET(request: NextRequest) {
  const { session, response } = await authorizeRequest(request, "reports", "read");
  if (response) return response;
  try {
    const days = Math.min(90, Math.max(7, Number(request.nextUrl.searchParams.get("days") ?? 30)));
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (days - 1));
    const [orders, products, users] = await Promise.all([
      prisma.order.findMany({
        where: { userId: session!.id, createdAt: { gte: from }, status: { not: "cancelled" } },
        select: { total: true, createdAt: true, createdBy: true, items: { select: { productId: true, productName: true, sku: true, quantity: true, price: true, purchasePrice: true, subtotal: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.product.findMany({ where: { userId: session!.id, deletedAt: null }, select: { id: true, name: true, sku: true, quantity: true, reservedQuantity: true, purchasePrice: true, status: true } }),
      prisma.user.findMany({ select: { id: true, name: true, email: true } }),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const daily = new Map<string, { date: string; sales: number; orders: number; profit: number }>();
    for (let i = 0; i < days; i++) { const d = new Date(from); d.setDate(from.getDate() + i); daily.set(dayKey(d), { date: dayKey(d), sales: 0, orders: 0, profit: 0 }); }
    const sellers = new Map<string, { sellerId: string; seller: string; sales: number; orders: number; profit: number }>();
    const productsById = new Map<string, { productId: string; name: string; sku: string | null; units: number; sales: number; cost: number }>();
    for (const order of orders) {
      let profit = 0;
      for (const item of order.items) {
        const qty = Math.max(0, n(item.quantity));
        const sales = Math.max(0, n(item.subtotal || n(item.price) * qty));
        const cost = Math.max(0, n(item.purchasePrice)) * qty;
        profit += sales - cost;
        const current = productsById.get(item.productId) ?? { productId: item.productId, name: item.productName, sku: item.sku ?? null, units: 0, sales: 0, cost: 0 };
        current.units += qty; current.sales += sales; current.cost += cost; productsById.set(item.productId, current);
      }
      const day = daily.get(dayKey(new Date(order.createdAt)));
      if (day) { day.sales += n(order.total); day.orders += 1; day.profit += profit; }
      const sellerUser = userMap.get(order.createdBy);
      const current = sellers.get(order.createdBy) ?? { sellerId: order.createdBy, seller: sellerUser?.name || sellerUser?.email || "Usuario", sales: 0, orders: 0, profit: 0 };
      current.sales += n(order.total); current.orders += 1; current.profit += profit; sellers.set(order.createdBy, current);
    }
    const productReports = [...productsById.values()].map((p) => ({ ...p, profit: p.sales - p.cost, margin: p.sales > 0 ? ((p.sales - p.cost) / p.sales) * 100 : 0 })).sort((a, b) => b.sales - a.sales).slice(0, 20);
    const soldIds = new Set(productsById.keys());
    const noMovement = products.filter((p) => !soldIds.has(p.id)).slice(0, 20).map((p) => ({ id: p.id, name: p.name, sku: p.sku, stock: Number(p.quantity), inventoryCost: Number(p.quantity) * n(p.purchasePrice) }));
    const lowStock = products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, stock: Math.max(0, Number(p.quantity) - Number(p.reservedQuantity)), status: p.status })).filter((p) => p.stock <= 5 || /low|agot|out|bajo/i.test(p.status ?? "")).sort((a, b) => a.stock - b.stock).slice(0, 20);
    const sales = orders.reduce((s, o) => s + n(o.total), 0);
    const cost = productReports.reduce((s, p) => s + p.cost, 0);
    return NextResponse.json({ range: { from: from.toISOString(), days }, daily: [...daily.values()], sellers: [...sellers.values()].sort((a, b) => b.sales - a.sales), products: productReports, noMovement, lowStock, summary: { sales, cost, grossProfit: sales - cost, margin: sales > 0 ? ((sales - cost) / sales) * 100 : 0, orders: orders.length, products: products.length } });
  } catch (error) {
    console.error("GET /api/reports/summary", error);
    return NextResponse.json({ error: "No se pudo generar el resumen de reportes" }, { status: 500 });
  }
}
