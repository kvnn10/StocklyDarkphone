import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";

function allowed(session: any) {
  return !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
}

async function db() {
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  return client;
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const client = await db();
  try {
    const params = new URL(request.url).searchParams;
    const status = params.get("status")?.trim() || "";
    const collection = client.db().collection("ServiceOrder");
    const query: any = { userId: session.id };
    if (status) query.status = status;

    const orders = await collection.find(query).sort({ createdAt: -1 }).limit(1000).toArray();
    const productIds = new Set<string>();
    for (const order of orders) {
      for (const part of Array.isArray(order.parts) ? order.parts : []) {
        if (typeof part?.productId === "string" && ObjectId.isValid(part.productId)) productIds.add(part.productId);
      }
    }

    const products = productIds.size
      ? await client.db().collection("Product").find({
          _id: { $in: [...productIds].map((id) => new ObjectId(id)) },
          userId: session.id,
        }).project({ name: 1, sku: 1, purchasePrice: 1 }).toArray()
      : [];
    const productMap = new Map(products.map((p: any) => [String(p._id), p]));

    const rows = orders.map((order: any) => {
      const parts = Array.isArray(order.parts) ? order.parts : [];
      const partsCost = parts.reduce((sum: number, part: any) => {
        const quantity = Math.max(0, Number(part?.quantity ?? 0));
        // Prefer the immutable cost snapshot stored on the service order.
        // This is essential for spot/external purchases and prevents later
        // product-price edits from rewriting historical profitability.
        const snapshotUnitCost = Number(part?.unitCost);
        const product = productMap.get(String(part.productId));
        const purchasePrice = Number(product?.purchasePrice ?? 0);
        const unitCost = Number.isFinite(snapshotUnitCost) && snapshotUnitCost >= 0
          ? snapshotUnitCost
          : purchasePrice;
        return sum + unitCost * quantity;
      }, 0);
      const partsRevenue = parts.reduce((sum: number, part: any) => sum + Math.max(0, Number(part?.subtotal ?? 0)), 0);
      const labor = Math.max(0, Number(order.labor ?? 0));
      const discount = Math.max(0, Number(order.discount ?? 0));
      const revenue = Math.max(0, Number(order.total ?? partsRevenue + labor - discount));
      const grossProfit = revenue - partsCost;
      const margin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      return {
        id: String(order._id),
        orderNumber: String(order.orderNumber ?? ""),
        customer: String(order.customer ?? ""),
        device: String(order.device ?? ""),
        status: String(order.status ?? ""),
        revenue,
        partsRevenue,
        partsCost,
        labor,
        discount,
        grossProfit,
        margin,
        createdAt: order.createdAt,
      };
    });

    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const partsCost = rows.reduce((s, r) => s + r.partsCost, 0);
    const grossProfit = rows.reduce((s, r) => s + r.grossProfit, 0);
    const labor = rows.reduce((s, r) => s + r.labor, 0);
    const averageMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    return NextResponse.json({
      summary: { orders: rows.length, revenue, partsCost, labor, grossProfit, averageMargin },
      orders: rows.slice(0, 100),
      warning: products.length < productIds.size
        ? "Algunos repuestos ya no tienen producto asociado; se usa el costo guardado en la orden cuando está disponible."
        : null,
    });
  } catch (error) {
    console.error("GET /api/service-orders/profitability", error);
    return NextResponse.json({ error: "No se pudo calcular la rentabilidad" }, { status: 500 });
  } finally {
    await client.close();
  }
}
