import { NextRequest, NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import { prisma } from "@/prisma/client";
import { getSessionFromRequest } from "@/utils/auth";

function allowed(session: any) {
  return !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
}

const n = (value: unknown) => Number(value ?? 0);

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const requestedMonths = Math.min(24, Math.max(1, Number(params.get("months") ?? 1)));
  const since = new Date();
  since.setMonth(since.getMonth() - requestedMonths);
  since.setHours(0, 0, 0, 0);

  try {
    const orders = await prisma.order.findMany({
      where: { userId: session.id, status: { not: "cancelled" }, createdAt: { gte: since } },
      select: {
        total: true,
        createdAt: true,
        items: { select: { quantity: true, product: { select: { purchasePrice: true } } } },
      },
    });

    let salesRevenue = 0;
    let salesCogs = 0;
    for (const order of orders) {
      salesRevenue += n(order.total);
      for (const item of order.items) {
        salesCogs += Math.max(0, n(item.quantity)) * Math.max(0, n(item.product?.purchasePrice));
      }
    }

    let serviceRevenue = 0;
    let servicePartsCost = 0;
    let serviceLabor = 0;
    let serviceOrders = 0;

    const mongo = new MongoClient(process.env.DATABASE_URL!);
    await mongo.connect();
    try {
      const serviceRows = await mongo.db().collection("ServiceOrder").find({
        userId: session.id,
        createdAt: { $gte: since },
      }).toArray();
      serviceOrders = serviceRows.length;

      const productIds = [...new Set(serviceRows.flatMap((row: any) =>
        Array.isArray(row.parts) ? row.parts.map((part: any) => part?.productId).filter(Boolean) : [],
      ))];
      const products = productIds.length
        ? await mongo.db().collection("Product").find({
            userId: session.id,
            _id: { $in: productIds.map((id: string) => {
              try { return new (require("mongodb").ObjectId)(id); } catch { return id; }
            }) },
          }).project({ purchasePrice: 1 }).toArray()
        : [];
      const purchaseMap = new Map(products.map((p: any) => [String(p._id), n(p.purchasePrice)]));

      for (const row of serviceRows) {
        const parts = Array.isArray(row.parts) ? row.parts : [];
        const partsCost = parts.reduce((sum: number, part: any) =>
          sum + Math.max(0, n(purchaseMap.get(String(part?.productId)) ?? part?.purchasePrice)) * Math.max(0, n(part?.quantity)), 0);
        servicePartsCost += partsCost;
        serviceLabor += Math.max(0, n(row.labor));
        serviceRevenue += Math.max(0, n(row.total ?? parts.reduce((s: number, p: any) => s + n(p?.subtotal), 0) + n(row.labor) - n(row.discount)));
      }
    } finally {
      await mongo.close();
    }

    const cash = await prisma.cashMovement.findMany({
      where: { userId: session.id, createdAt: { gte: since } },
      select: { type: true, amount: true },
    });
    const expenses = cash.reduce((sum, movement) => {
      const type = String(movement.type ?? "").toLowerCase();
      return /expense|egreso|outflow|salida/.test(type) ? sum + Math.max(0, n(movement.amount)) : sum;
    }, 0);

    const revenue = salesRevenue + serviceRevenue;
    const directCosts = salesCogs + servicePartsCost;
    const grossProfit = revenue - directCosts;
    const netProfit = grossProfit - expenses;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

    return NextResponse.json({
      periodMonths: requestedMonths,
      summary: {
        revenue,
        salesRevenue,
        serviceRevenue,
        directCosts,
        salesCogs,
        servicePartsCost,
        serviceLabor,
        expenses,
        grossProfit,
        netProfit,
        grossMargin,
        netMargin,
        orders: orders.length,
        serviceOrders,
      },
    });
  } catch (error) {
    console.error("GET /api/dashboard/profitability", error);
    return NextResponse.json({ error: "No se pudo calcular la rentabilidad" }, { status: 500 });
  }
}
