import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";

async function db() {
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  return client;
}

function allowed(session: any) {
  return !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const orderId = new URL(request.url).searchParams.get("orderId")?.trim() ?? "";
  if (!ObjectId.isValid(orderId)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });

  const client = await db();
  try {
    const orders = client.db().collection("ServiceOrder");
    const products = client.db().collection("Product");
    const order = await orders.findOne({ _id: new ObjectId(orderId), userId: session.id });
    if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

    const parts = Array.isArray(order.parts) ? [...order.parts] : [];
    let changed = false;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] as any;
      if (part.warrantyDays !== undefined || !ObjectId.isValid(String(part.productId))) continue;
      const product = await products.findOne(
        { _id: new ObjectId(String(part.productId)), userId: session.id },
        { projection: { warrantyDays: 1 } },
      );
      const warrantyDays = product && Number.isInteger(product.warrantyDays) ? Number(product.warrantyDays) : 0;
      parts[index] = { ...part, warrantyDays, warrantySource: "product_default" };
      changed = true;
    }

    if (changed) await orders.updateOne({ _id: order._id }, { $set: { parts, updatedAt: new Date() } });
    return NextResponse.json({ parts });
  } catch (error) {
    console.error("GET /api/service-orders/part-warranty", error);
    return NextResponse.json({ error: "No se pudieron cargar las garantías" }, { status: 500 });
  } finally {
    await client.close();
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const partId = typeof body.partId === "string" ? body.partId.trim() : "";
  const warrantyDays = Number(body.warrantyDays);
  if (!ObjectId.isValid(orderId) || !partId || !Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) {
    return NextResponse.json({ error: "Datos de garantía inválidos" }, { status: 400 });
  }

  const client = await db();
  try {
    const orders = client.db().collection("ServiceOrder");
    const order = await orders.findOne({ _id: new ObjectId(orderId), userId: session.id });
    if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

    const parts = Array.isArray(order.parts) ? [...order.parts] : [];
    const index = parts.findIndex((part: any) => String(part.id) === partId);
    if (index < 0) return NextResponse.json({ error: "Repuesto no encontrado" }, { status: 404 });

    parts[index] = {
      ...(parts[index] as any),
      warrantyDays,
      warrantySource: "manual",
      warrantyUpdatedAt: new Date(),
      warrantyUpdatedBy: session.id,
    };
    await orders.updateOne({ _id: order._id }, { $set: { parts, updatedAt: new Date(), updatedBy: session.id } });
    return NextResponse.json({ parts });
  } catch (error) {
    console.error("PUT /api/service-orders/part-warranty", error);
    return NextResponse.json({ error: "No se pudo guardar la garantía" }, { status: 500 });
  } finally {
    await client.close();
  }
}
