import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const allowed = (session: any) => !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const orderId = new URL(request.url).searchParams.get("orderId")?.trim() ?? "";
  if (!validId(orderId)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });
  try {
    const order = await prisma.serviceOrder.findFirst({ where: { id: orderId, userId: session.id }, include: { items: true } });
    if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    const history = order.imei || order.serialNumber
      ? await prisma.serviceOrder.findMany({ where: { userId: session.id, OR: [{ imei: order.imei || undefined }, { serialNumber: order.serialNumber || undefined }] }, orderBy: { createdAt: "desc" }, take: 50 })
      : [order];
    return NextResponse.json({ order, history });
  } catch (error) {
    console.error("GET /api/service-orders/warranty", error);
    return NextResponse.json({ error: "No se pudo cargar la garantía" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const warrantyDays = Number(body.warrantyDays);
    if (!validId(orderId) || !Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) return NextResponse.json({ error: "Días de garantía inválidos" }, { status: 400 });
    const existing = await prisma.serviceOrder.findFirst({ where: { id: orderId, userId: session.id } });
    if (!existing) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    if (existing.status !== "delivered" && warrantyDays > 0) return NextResponse.json({ error: "La garantía se puede activar cuando la orden esté entregada" }, { status: 409 });
    const deliveredAt = existing.deliveredAt ?? new Date();
    const warrantyExpiresAt = warrantyDays > 0 ? new Date(deliveredAt.getTime() + warrantyDays * 86400000) : null;
    const warrantyNote = typeof body.warrantyNote === "string" ? body.warrantyNote.trim().slice(0, 500) : "";
    const accessories = existing.accessories && typeof existing.accessories === "object" && !Array.isArray(existing.accessories) ? { ...(existing.accessories as Record<string, unknown>), warrantyNote } : { warrantyNote };
    const saved = await prisma.serviceOrder.update({ where: { id: orderId }, data: { warrantyDays, warrantyExpiresAt, accessories, updatedAt: new Date(), updatedBy: session.id } });
    await writeAuditLog({ userId: session.id, action: "SERVICE_WARRANTY_UPDATED", entityType: "ServiceOrder", entityId: orderId, details: { warrantyDays, warrantyExpiresAt, warrantyNote } });
    return NextResponse.json({ ...saved, warrantyUntil: saved.warrantyExpiresAt });
  } catch (error) {
    console.error("PUT /api/service-orders/warranty", error);
    return NextResponse.json({ error: "No se pudo guardar la garantía" }, { status: 500 });
  }
}
