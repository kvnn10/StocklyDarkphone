import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const ROLES = new Set(["admin", "user", "retailer"]);
const validId = (v: unknown) => typeof v === "string" && ObjectId.isValid(v);
const ALLOWED = new Set(["client", "service", "sale", "invoice", "warranty", "return"]);

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.has(session.role ?? "")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await context.params;
  if (!validId(id)) return NextResponse.json({ error: "Equipo inválido" }, { status: 400 });
  const body = await request.json();
  const type = typeof body.type === "string" ? body.type : "";
  const referenceId = typeof body.referenceId === "string" ? body.referenceId : null;
  if (!ALLOWED.has(type)) return NextResponse.json({ error: "Tipo de vínculo inválido" }, { status: 400 });
  if (!["client", "warranty"].includes(type) && !validId(referenceId)) return NextResponse.json({ error: "Referencia inválida" }, { status: 400 });

  const client = new MongoClient(process.env.DATABASE_URL!);
  try {
    await client.connect();
    const db = client.db();
    const devices = db.collection("CustomerDevice");
    const device = await devices.findOne({ _id: new ObjectId(id), userId: session.id, archivedAt: { $exists: false } });
    if (!device) return NextResponse.json({ error: "Equipo no encontrado" }, { status: 404 });
    const update: Record<string, unknown> = { updatedAt: new Date(), updatedBy: session.id };

    if (type === "client") {
      if (!validId(referenceId)) return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
      const user = await db.collection("User").findOne({ _id: new ObjectId(referenceId), role: "client" }, { projection: { name: 1 } });
      if (!user) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
      update.clientId = referenceId; update.clientName = user.name ?? "";
    } else if (type === "service") {
      const service = await prisma.serviceOrder.findFirst({ where: { id: referenceId!, userId: session.id } });
      if (!service) return NextResponse.json({ error: "Orden de servicio no encontrada" }, { status: 404 });
      update.serviceOrderId = referenceId; update.status = service.status === "delivered" ? "available" : "in_repair";
    } else if (type === "sale") {
      const order = await prisma.order.findFirst({ where: { id: referenceId!, userId: session.id } });
      if (!order) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
      update.saleOrderId = referenceId; update.status = "sold";
      if (device.productId) {
        await prisma.product.updateMany({ where: { id: device.productId, userId: session.id }, data: { quantity: 0n, updatedAt: new Date(), updatedBy: session.id } });
        if (device.warehouseId && validId(device.warehouseId)) await prisma.stockAllocation.updateMany({ where: { productId: device.productId, warehouseId: device.warehouseId, userId: session.id }, data: { quantity: 0n, updatedAt: new Date() } });
      }
    } else if (type === "invoice") {
      const invoice = await prisma.invoice.findFirst({ where: { id: referenceId!, userId: session.id } });
      if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
      update.invoiceId = referenceId;
    } else if (type === "warranty") {
      const days = Number(body.warrantyDays ?? device.warrantyDays ?? 0);
      if (!Number.isInteger(days) || days < 0 || days > 3650) return NextResponse.json({ error: "Garantía inválida" }, { status: 400 });
      update.warrantyDays = days; update.warrantyStartedAt = new Date(); update.warrantyExpiresAt = days ? new Date(Date.now() + days * 86400000) : null;
    } else if (type === "return") {
      update.status = "available"; update.saleOrderId = null; update.returnedAt = new Date(); update.returnReason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;
      if (device.productId) {
        await prisma.product.updateMany({ where: { id: device.productId, userId: session.id }, data: { quantity: 1n, updatedAt: new Date(), updatedBy: session.id } });
        if (device.warehouseId && validId(device.warehouseId)) await prisma.stockAllocation.updateMany({ where: { productId: device.productId, warehouseId: device.warehouseId, userId: session.id }, data: { quantity: 1n, updatedAt: new Date() } });
      }
    }

    await devices.updateOne({ _id: new ObjectId(id), userId: session.id }, { $set: update });
    await db.collection("CustomerDeviceHistory").insertOne({ deviceId: id, userId: session.id, type, referenceId, changes: update, createdAt: new Date(), createdBy: session.id });
    await writeAuditLog({ userId: session.id, action: "DEVICE_LINKED", entityType: "CustomerDevice", entityId: id, details: { type, referenceId } });
    return NextResponse.json({ success: true, id, type, referenceId, ...update });
  } catch (error) {
    console.error("POST /api/devices/[id]/link", error);
    return NextResponse.json({ error: "No se pudo vincular el equipo" }, { status: 500 });
  } finally { await client.close(); }
}
