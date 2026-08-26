import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { mergeProductListWhere } from "@/lib/products/product-query";

const n = (v: unknown) => Number(v ?? 0);

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !["admin", "user", "retailer"].includes(session.role ?? "")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const products = await prisma.product.findMany({
    where: mergeProductListWhere({ userId: session.id }),
    select: { id: true, name: true, sku: true, quantity: true, reservedQuantity: true, price: true, purchasePrice: true, status: true },
  });

  const ids = products.map((p) => p.id);
  const sales = ids.length
    ? await prisma.orderItem.findMany({
        where: { productId: { in: ids }, order: { userId: session.id, status: { not: "cancelled" } } },
        select: { productId: true, quantity: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const salesByProduct = new Map<string, { units: number; recentUnits: number; lastSale: Date | null }>();
  const cutoff = Date.now() - 30 * 86400000;
  for (const s of sales) {
    const cur = salesByProduct.get(s.productId) ?? { units: 0, recentUnits: 0, lastSale: null };
    cur.units += n(s.quantity);
    if (new Date(s.createdAt).getTime() >= cutoff) cur.recentUnits += n(s.quantity);
    if (!cur.lastSale || new Date(s.createdAt) > cur.lastSale) cur.lastSale = new Date(s.createdAt);
    salesByProduct.set(s.productId, cur);
  }

  const recommendations = products.map((p) => {
    const stock = Math.max(0, n(p.quantity) - n(p.reservedQuantity));
    const stats = salesByProduct.get(p.id) ?? { units: 0, recentUnits: 0, lastSale: null };
    const weeklyVelocity = stats.recentUnits / 4.285;
    const daysCover = weeklyVelocity > 0 ? stock / (weeklyVelocity / 7) : null;
    const margin = n(p.price) - n(p.purchasePrice);
    const marginPct = n(p.price) > 0 ? margin / n(p.price) * 100 : 0;
    let priority: "critical" | "reorder" | "slow" | "healthy" = "healthy";
    let reason = "Stock saludable para la velocidad actual.";
    let suggestedQty = 0;

    if (stock === 0 && stats.recentUnits > 0) {
      priority = "critical"; reason = "Agotado y tiene ventas recientes."; suggestedQty = Math.max(1, Math.ceil(weeklyVelocity * 3));
    } else if (daysCover !== null && daysCover < 14 && stats.recentUnits > 0) {
      priority = "reorder"; reason = `Aproximadamente ${Math.max(1, Math.round(daysCover))} días de cobertura.`; suggestedQty = Math.max(1, Math.ceil(weeklyVelocity * 4 - stock));
    } else if (stats.units === 0 && stock > 0) {
      priority = "slow"; reason = "No registra ventas en el historial disponible; revisar antes de comprar más.";
    }

    return { id: p.id, name: p.name, sku: p.sku, stock, sold30d: stats.recentUnits, totalSold: stats.units, daysCover: daysCover === null ? null : Math.round(daysCover), marginPct, inventoryValue: stock * n(p.purchasePrice), priority, reason, suggestedQty };
  }).filter((p) => p.priority !== "healthy").sort((a, b) => ({ critical: 0, reorder: 1, slow: 2 }[a.priority] - ({ critical: 0, reorder: 1, slow: 2 }[b.priority])) || b.sold30d - a.sold30d);

  const inventoryCost = products.reduce((sum, p) => sum + Math.max(0, n(p.quantity) - n(p.reservedQuantity)) * Math.max(0, n(p.purchasePrice)), 0);
  const inventoryRetail = products.reduce((sum, p) => sum + Math.max(0, n(p.quantity) - n(p.reservedQuantity)) * Math.max(0, n(p.price)), 0);

  return NextResponse.json({ summary: { products: products.length, inventoryCost, inventoryRetail, potentialMargin: inventoryRetail - inventoryCost, critical: recommendations.filter((r) => r.priority === "critical").length, reorder: recommendations.filter((r) => r.priority === "reorder").length, slow: recommendations.filter((r) => r.priority === "slow").length }, recommendations: recommendations.slice(0, 12) });
}
