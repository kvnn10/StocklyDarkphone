import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

async function db() { const client = new MongoClient(process.env.DATABASE_URL!); await client.connect(); return client; }
function allowed(session: any) { return !!session && ["admin", "user", "retailer"].includes(session.role ?? ""); }

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const params = new URL(request.url).searchParams, orderId = params.get("orderId")?.trim() ?? "";
  if (!ObjectId.isValid(orderId)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });
  const client = await db();
  try {
    const orders = client.db().collection("ServiceOrder");
    const order = await orders.findOne({ _id: new ObjectId(orderId), userId: session.id });
    if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    const deviceQuery: any[] = [];
    if (String(order.imei || "").trim()) deviceQuery.push({ imei: String(order.imei).trim() });
    if (String(order.serial || "").trim()) deviceQuery.push({ serial: String(order.serial).trim() });
    const history = deviceQuery.length ? await orders.find({ userId: session.id, $or: deviceQuery }).sort({ createdAt: -1 }).limit(50).toArray() : [order];
    return NextResponse.json({ order, history });
  } catch (error) { console.error("GET /api/service-orders/warranty", error); return NextResponse.json({ error: "No se pudo cargar la garantía" }, { status: 500 }); }
  finally { await client.close(); }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json();
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const warrantyDays = Number(body.warrantyDays);
  if (!ObjectId.isValid(orderId) || !Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) return NextResponse.json({ error: "Días de garantía inválidos" }, { status: 400 });
  const client = await db();
  try {
    const orders = client.db().collection("ServiceOrder"), existing = await orders.findOne({ _id: new ObjectId(orderId), userId: session.id });
    if (!existing) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    if (existing.status !== "delivered" && warrantyDays > 0) return NextResponse.json({ error: "La garantía se puede activar cuando la orden esté entregada" }, { status: 409 });
    const deliveredAt = existing.deliveredAt ? new Date(existing.deliveredAt) : new Date();
    const warrantyUntil = warrantyDays > 0 ? new Date(deliveredAt.getTime() + warrantyDays * 86400000) : null;
    const warrantyNote = typeof body.warrantyNote === "string" ? body.warrantyNote.trim().slice(0, 500) : "";
    await orders.updateOne({ _id: existing._id }, { $set: { warrantyDays, warrantyUntil, warrantyNote, updatedAt: new Date(), updatedBy: session.id } });
    await writeAuditLog({ userId: session.id, action: "SERVICE_WARRANTY_UPDATED", entityType: "ServiceOrder", entityId: orderId, details: { warrantyDays, warrantyUntil, warrantyNote } });
    return NextResponse.json(await orders.findOne({ _id: existing._id }));
  } catch (error) { console.error("PUT /api/service-orders/warranty", error); return NextResponse.json({ error: "No se pudo guardar la garantía" }, { status: 500 }); }
  finally { await client.close(); }
}
