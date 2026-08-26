import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

async function db() { const client = new MongoClient(process.env.DATABASE_URL!); await client.connect(); return client; }
function allowed(session: any) { return !!session && ["admin", "user", "retailer"].includes(session.role ?? ""); }

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const originalId = typeof body.originalOrderId === "string" && ObjectId.isValid(body.originalOrderId) ? body.originalOrderId : "";
    const warrantyPartId = typeof body.warrantyPartId === "string" ? body.warrantyPartId : "";
    const issue = typeof body.issue === "string" ? body.issue.trim() : "";
    if (!originalId) return NextResponse.json({ error: "Orden original inválida" }, { status: 400 });
    if (!issue) return NextResponse.json({ error: "Describe la falla del reingreso por garantía" }, { status: 400 });
    const client = await db();
    try {
      const orders = client.db().collection("ServiceOrder");
      const original: any = await orders.findOne({ _id: new ObjectId(originalId), userId: session.id });
      if (!original) return NextResponse.json({ error: "Orden original no encontrada" }, { status: 404 });
      if (original.status !== "delivered") return NextResponse.json({ error: "La reparación original debe estar entregada para generar un reingreso por garantía" }, { status: 409 });
      const parts = Array.isArray(original.parts) ? original.parts : [];
      const warrantyPart: any = warrantyPartId ? parts.find((part: any) => part.id === warrantyPartId) : null;
      const now = new Date();
      const warrantyDays = Number(warrantyPart?.warrantyDays ?? original.warrantyDays ?? 0);
      const warrantyUntilValue = warrantyPart?.warrantyUntil ?? original.warrantyUntil;
      if (warrantyUntilValue && new Date(warrantyUntilValue).getTime() < now.getTime()) return NextResponse.json({ error: "La garantía seleccionada ya está vencida" }, { status: 409 });
      const count = await orders.countDocuments({ userId: session.id });
      const order = {
        orderNumber: `ST-${String(count + 1).padStart(5, "0")}`,
        userId: session.id,
        customer: original.customer,
        phone: original.phone,
        device: original.device,
        imei: original.imei || "",
        serial: original.serial || "",
        issue,
        status: "received",
        diagnosis: "",
        technicianNotes: "",
        technicianId: "",
        total: 0,
        paid: 0,
        balance: 0,
        parts: [],
        payments: [],
        statusHistory: [{ status: "received", at: now, by: session.id }],
        warrantyReentry: true,
        warrantyOriginalOrderId: original._id,
        warrantyOriginalOrderNumber: original.orderNumber,
        warrantyPartId: warrantyPart?.id || "",
        warrantyPartName: warrantyPart?.name || "",
        warrantyDays,
        warrantyUntil: warrantyUntilValue ? new Date(warrantyUntilValue) : null,
        warrantyReason: issue,
        createdAt: now,
        updatedAt: now,
        createdBy: session.id,
        updatedBy: session.id,
      };
      const result = await orders.insertOne(order);
      await writeAuditLog({ userId: session.id, action: "SERVICE_WARRANTY_REENTRY_CREATED", entityType: "ServiceOrder", entityId: String(result.insertedId), details: { orderNumber: order.orderNumber, originalOrderId: originalId, originalOrderNumber: original.orderNumber, warrantyPartId: warrantyPart?.id || null, warrantyPartName: warrantyPart?.name || null } });
      return NextResponse.json({ ...order, _id: result.insertedId }, { status: 201 });
    } finally { await client.close(); }
  } catch (error) { console.error("POST /api/service-orders/warranty-reentry", error); return NextResponse.json({ error: "No se pudo crear el reingreso por garantía" }, { status: 500 }); }
}
