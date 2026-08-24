import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

const STATUSES = ["received", "diagnosis", "awaiting_approval", "repairing", "ready", "delivered", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

function allowed(session: any) {
  return session && ["admin", "user", "retailer"].includes(session.role ?? "");
}

async function db() {
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  return client;
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const client = await db();
  try {
    const search = new URL(request.url).searchParams.get("search")?.trim() ?? "";
    const status = new URL(request.url).searchParams.get("status")?.trim() ?? "";
    const query: any = { userId: session.id };
    if (status && STATUSES.includes(status as Status)) query.status = status;
    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: "i" } },
        { customer: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { device: { $regex: search, $options: "i" } },
        { imei: { $regex: search, $options: "i" } },
        { serial: { $regex: search, $options: "i" } },
      ];
    }

    const orders = await client.db().collection("ServiceOrder").find(query).sort({ createdAt: -1 }).limit(500).toArray();
    const stats = {
      open: orders.filter((o: any) => !["delivered", "cancelled"].includes(o.status)).length,
      repairing: orders.filter((o: any) => o.status === "repairing").length,
      awaitingApproval: orders.filter((o: any) => o.status === "awaiting_approval").length,
      pendingBalance: orders.reduce((sum: number, o: any) => sum + Math.max(0, Number(o.total || 0) - Number(o.paid || 0)), 0),
    };
    return NextResponse.json({ orders, stats });
  } catch (error) {
    console.error("GET /api/service-orders", error);
    return NextResponse.json({ error: "No se pudieron cargar las órdenes" }, { status: 500 });
  } finally {
    await client.close();
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await request.json();
    const customer = typeof body.customer === "string" ? body.customer.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const device = typeof body.device === "string" ? body.device.trim() : "";
    const imei = typeof body.imei === "string" ? body.imei.trim() : "";
    const serial = typeof body.serial === "string" ? body.serial.trim() : "";
    const issue = typeof body.issue === "string" ? body.issue.trim() : "";
    const status = STATUSES.includes(body.status) ? body.status : "received";
    const total = Number(body.total || 0);
    const paid = Number(body.paid || 0);

    if (!customer || !phone || !device || !issue) {
      return NextResponse.json({ error: "Cliente, teléfono, equipo y falla son obligatorios" }, { status: 400 });
    }
    if (![total, paid].every(Number.isFinite) || total < 0 || paid < 0 || paid > total) {
      return NextResponse.json({ error: "Valores de dinero inválidos" }, { status: 400 });
    }

    const client = await db();
    try {
      const collection = client.db().collection("ServiceOrder");
      const now = new Date();
      const count = await collection.countDocuments({ userId: session.id });
      const order = {
        orderNumber: `ST-${String(count + 1).padStart(5, "0")}`,
        userId: session.id,
        customer,
        phone,
        device,
        imei,
        serial,
        issue,
        status,
        diagnosis: "",
        technicianNotes: "",
        total,
        paid,
        balance: total - paid,
        createdAt: now,
        updatedAt: now,
        createdBy: session.id,
        updatedBy: session.id,
      };
      const result = await collection.insertOne(order);
      const saved = { ...order, _id: result.insertedId };
      await writeAuditLog({ userId: session.id, action: "SERVICE_ORDER_CREATED", entityType: "ServiceOrder", entityId: String(result.insertedId), details: { orderNumber: order.orderNumber, customer, device, status } });
      return NextResponse.json(saved, { status: 201 });
    } finally {
      await client.close();
    }
  } catch (error) {
    console.error("POST /api/service-orders", error);
    return NextResponse.json({ error: "No se pudo crear la orden" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });

    const update: any = { updatedAt: new Date(), updatedBy: session.id };
    for (const key of ["customer", "phone", "device", "imei", "serial", "issue", "diagnosis", "technicianNotes"]) {
      if (body[key] !== undefined) update[key] = typeof body[key] === "string" ? body[key].trim() : body[key];
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
      update.status = body.status;
    }
    if (body.total !== undefined) update.total = Number(body.total);
    if (body.paid !== undefined) update.paid = Number(body.paid);

    const client = await db();
    try {
      const collection = client.db().collection("ServiceOrder");
      const existing = await collection.findOne({ _id: new ObjectId(id), userId: session.id });
      if (!existing) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
      const total = update.total !== undefined ? update.total : Number(existing.total || 0);
      const paid = update.paid !== undefined ? update.paid : Number(existing.paid || 0);
      if (!Number.isFinite(total) || !Number.isFinite(paid) || total < 0 || paid < 0 || paid > total) return NextResponse.json({ error: "Valores de dinero inválidos" }, { status: 400 });
      update.balance = total - paid;
      await collection.updateOne({ _id: new ObjectId(id), userId: session.id }, { $set: update });
      const saved = await collection.findOne({ _id: new ObjectId(id), userId: session.id });
      await writeAuditLog({ userId: session.id, action: "SERVICE_ORDER_UPDATED", entityType: "ServiceOrder", entityId: id, details: { changes: update } });
      return NextResponse.json(saved);
    } finally {
      await client.close();
    }
  } catch (error) {
    console.error("PUT /api/service-orders", error);
    return NextResponse.json({ error: "No se pudo actualizar la orden" }, { status: 500 });
  }
}
