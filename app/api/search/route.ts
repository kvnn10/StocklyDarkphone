import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";

const ROLES = new Set(["admin", "user", "retailer"]);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toObjectId(value: unknown) {
  return typeof value === "string" && ObjectId.isValid(value) ? new ObjectId(value) : null;
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.has(session.role ?? "")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });
  if (q.length > 80) return NextResponse.json({ error: "Búsqueda demasiado larga" }, { status: 400 });

  const regex = new RegExp(escapeRegex(q), "i");
  const client = new MongoClient(process.env.DATABASE_URL!);

  try {
    await client.connect();
    const database = client.db();
    const userObjectId = toObjectId(session.id);
    if (!userObjectId) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    const [products, clients, orders, devices] = await Promise.all([
      database.collection("Product").find({ userId: userObjectId, deletedAt: { $exists: false }, $or: [{ name: regex }, { sku: regex }] }, { projection: { name: 1, sku: 1 } }).limit(8).toArray(),
      database.collection("User").find({ role: "client", $or: [{ name: regex }, { email: regex }, { phone: regex }, { document: regex }] }, { projection: { name: 1, email: 1, phone: 1, document: 1 } }).limit(8).toArray(),
      database.collection("Order").find({ userId: userObjectId, $or: [{ orderNumber: regex }, { trackingNumber: regex }] }, { projection: { orderNumber: 1, status: 1, paymentStatus: 1, total: 1 } }).sort({ createdAt: -1 }).limit(8).toArray(),
      database.collection("CustomerDevice").find({ userId: session.id, archivedAt: { $exists: false }, $or: [{ name: regex }, { brand: regex }, { model: regex }, { imei: regex }, { serial: regex }] }, { projection: { name: 1, brand: 1, model: 1, imei: 1, serial: 1, clientName: 1 } }).limit(8).toArray(),
    ]);

    const results = [
      ...products.map((item) => ({ type: "product", id: item._id.toHexString(), title: item.name, subtitle: item.sku ? `SKU ${item.sku}` : "Producto", href: `/products?search=${encodeURIComponent(item.sku ?? item.name)}` })),
      ...clients.map((item) => ({ type: "client", id: item._id.toHexString(), title: item.name, subtitle: item.email ?? item.phone ?? "Cliente", href: `/clients?search=${encodeURIComponent(item.email ?? item.name)}` })),
      ...orders.map((item) => ({ type: "order", id: item._id.toHexString(), title: item.orderNumber, subtitle: `${item.status ?? "Venta"} · ${Number(item.total ?? 0).toLocaleString("es-CO")}`, href: `/orders/${item._id.toHexString()}` })),
      ...devices.map((item) => ({ type: "device", id: item._id.toHexString(), title: item.name || `${item.brand ?? ""} ${item.model ?? ""}`.trim(), subtitle: item.imei || item.serial || item.clientName || "Equipo", href: `/devices?search=${encodeURIComponent(item.imei ?? item.serial ?? item.name ?? "")}` })),
    ].slice(0, 24);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("GET /api/search", error);
    return NextResponse.json({ error: "No se pudo realizar la búsqueda" }, { status: 500 });
  } finally {
    await client.close();
  }
}
