import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const allowed = (session: any) => !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const meta = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const originalId = typeof body.originalOrderId === "string" ? body.originalOrderId : "";
    const warrantyPartId = typeof body.warrantyPartId === "string" ? body.warrantyPartId : "";
    const issue = typeof body.issue === "string" ? body.issue.trim() : "";
    if (!validId(originalId)) return NextResponse.json({ error: "Orden original inválida" }, { status: 400 });
    if (!issue) return NextResponse.json({ error: "Describe la falla del reingreso por garantía" }, { status: 400 });
    const original = await prisma.serviceOrder.findFirst({ where: { id: originalId, userId: session.id }, include: { items: true } });
    if (!original) return NextResponse.json({ error: "Orden original no encontrada" }, { status: 404 });
    if (original.status !== "delivered") return NextResponse.json({ error: "La reparación original debe estar entregada para generar un reingreso por garantía" }, { status: 409 });
    const originalMeta = meta(original.accessories);
    const warrantyMap = originalMeta.partWarranties ?? {};
    const warrantyPart = warrantyPartId ? original.items.find(item => item.id === warrantyPartId) : null;
    const warrantyData = warrantyPartId ? warrantyMap[warrantyPartId] : null;
    const now = new Date();
    const warrantyDays = Number(warrantyData?.warrantyDays ?? original.warrantyDays ?? 0);
    const warrantyUntil = warrantyData?.warrantyUntil ?? (original.warrantyExpiresAt ? original.warrantyExpiresAt.toISOString() : null);
    if (warrantyUntil && new Date(warrantyUntil).getTime() < now.getTime()) return NextResponse.json({ error: "La garantía seleccionada ya está vencida" }, { status: 409 });
    const orderNumber = `ST-${Date.now().toString().slice(-10)}`;
    const accessories = { customerName: originalMeta.customerName ?? "", customerPhone: originalMeta.customerPhone ?? "", warrantyReentry: true, warrantyOriginalOrderId: original.id, warrantyOriginalOrderNumber: original.orderNumber, warrantyPartId: warrantyPart?.id ?? null, warrantyPartName: warrantyPart?.productName ?? null, warrantyReason: issue, warrantyUntil, statusHistory: [{ status: "received", at: now.toISOString(), by: session.id }] };
    const created = await prisma.serviceOrder.create({ data: { orderNumber, userId: session.id, clientId: original.clientId, deviceType: original.deviceType, brand: original.brand, model: original.model, imei: original.imei, serialNumber: original.serialNumber, reportedIssue: issue, initialCondition: original.initialCondition, accessories, status: "received", total: 0, amountPaid: 0, amountDue: 0, warrantyDays, warrantyExpiresAt: warrantyUntil ? new Date(warrantyUntil) : null, createdAt: now, updatedAt: now, createdBy: session.id, updatedBy: session.id }, include: { items: true, payments: true } });
    await writeAuditLog({ userId: session.id, action: "SERVICE_WARRANTY_REENTRY_CREATED", entityType: "ServiceOrder", entityId: created.id, details: { orderNumber, originalOrderId: originalId, originalOrderNumber: original.orderNumber, warrantyPartId: warrantyPart?.id ?? null, warrantyPartName: warrantyPart?.productName ?? null } });
    return NextResponse.json({ ...created, _id: created.id }, { status: 201 });
  } catch (error) { console.error("POST /api/service-orders/warranty-reentry", error); return NextResponse.json({ error: "No se pudo crear el reingreso por garantía" }, { status: 500 }); }
}
