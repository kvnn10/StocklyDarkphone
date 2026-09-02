import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/prisma/client";

const STATUSES = ["received", "diagnosis", "awaiting_approval", "repairing", "ready", "delivered", "cancelled"] as const;
const ALLOWED_ROLES = ["admin", "user", "retailer"];
const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const meta = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const toDate = (value: unknown) => {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ALLOWED_ROLES.includes(session.role ?? "")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    if (!validId(id)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });
    const existing = await prisma.serviceOrder.findFirst({ where: { id, userId: session.id } });
    if (!existing) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

    const nextStatus = typeof body.status === "string" ? body.status : existing.status;
    if (!STATUSES.includes(nextStatus as any)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    if ((existing.status === "delivered" || existing.status === "cancelled") && nextStatus !== existing.status) return NextResponse.json({ error: "Una orden cerrada no puede reabrirse desde el ciclo de vida" }, { status: 409 });
    if (nextStatus === "delivered" && existing.amountDue > 0) return NextResponse.json({ error: "No se puede entregar una orden con saldo pendiente" }, { status: 409 });
    if (nextStatus === "delivered" && !existing.diagnosis?.trim()) return NextResponse.json({ error: "Registra el diagnóstico antes de entregar la orden" }, { status: 409 });

    const estimatedDelivery = toDate(body.estimatedDelivery);
    if (estimatedDelivery === undefined) return NextResponse.json({ error: "Fecha estimada inválida" }, { status: 400 });
    const warrantyDays = body.warrantyDays === undefined ? existing.warrantyDays : Number(body.warrantyDays);
    if (!Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) return NextResponse.json({ error: "La garantía debe estar entre 0 y 3650 días" }, { status: 400 });
    const notes = body.notes === undefined ? existing.notes : (typeof body.notes === "string" ? body.notes.trim().slice(0, 4000) : "");
    const now = new Date();
    const deliveredAt = nextStatus === "delivered" ? (existing.deliveredAt ?? now) : existing.deliveredAt;
    const warrantyExpiresAt = nextStatus === "delivered" && warrantyDays > 0
      ? new Date(deliveredAt!.getTime() + warrantyDays * 86400000)
      : nextStatus === "delivered" ? null : existing.warrantyExpiresAt;

    const currentMeta = meta(existing.accessories);
    const currentHistory = Array.isArray(currentMeta.statusHistory) ? currentMeta.statusHistory : [];
    const statusChanged = nextStatus !== existing.status;
    const statusHistory = statusChanged
      ? [...currentHistory, { status: nextStatus, at: now.toISOString(), by: session.id }].slice(-50)
      : currentHistory;

    const saved = await prisma.serviceOrder.update({
      where: { id },
      data: {
        status: nextStatus,
        estimatedDelivery: estimatedDelivery === undefined ? existing.estimatedDelivery : estimatedDelivery,
        deliveredAt,
        warrantyDays,
        warrantyExpiresAt,
        notes,
        accessories: { ...currentMeta, statusHistory },
        updatedAt: now,
        updatedBy: session.id,
      },
      include: { items: true, payments: true },
    });

    await writeAuditLog({
      userId: session.id,
      action: statusChanged ? "SERVICE_ORDER_LIFECYCLE_UPDATED" : "SERVICE_ORDER_SCHEDULE_UPDATED",
      entityType: "ServiceOrder",
      entityId: id,
      details: { orderNumber: saved.orderNumber, previousStatus: existing.status, status: nextStatus, estimatedDelivery: saved.estimatedDelivery, deliveredAt: saved.deliveredAt, warrantyDays, warrantyExpiresAt, hasNotes: Boolean(notes) },
    });

    return NextResponse.json({
      id: saved.id,
      orderNumber: saved.orderNumber,
      status: saved.status,
      estimatedDelivery: saved.estimatedDelivery,
      deliveredAt: saved.deliveredAt,
      warrantyDays: saved.warrantyDays,
      warrantyExpiresAt: saved.warrantyExpiresAt,
      notes: saved.notes,
      statusHistory,
    });
  } catch (error) {
    console.error("PUT /api/service-orders/lifecycle", error);
    return NextResponse.json({ error: "No se pudo actualizar el ciclo de vida" }, { status: 500 });
  }
}
