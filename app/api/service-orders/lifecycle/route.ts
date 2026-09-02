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
    const estimatedDelivery = toDate(body.estimatedDelivery);
    if (estimatedDelivery === undefined) return NextResponse.json({ error: "Fecha estimada inválida" }, { status: 400 });

    const result = await prisma.$transaction(async tx => {
      const existing = await tx.serviceOrder.findFirst({ where: { id, userId: session.id }, include: { items: true, payments: true } });
      if (!existing) throw new Error("Orden no encontrada");
      const nextStatus = typeof body.status === "string" ? body.status : existing.status;
      if (!STATUSES.includes(nextStatus as any)) throw new Error("Estado inválido");
      if ((existing.status === "delivered" || existing.status === "cancelled") && nextStatus !== existing.status) throw new Error("Una orden cerrada no puede reabrirse desde el ciclo de vida");
      if (nextStatus === "delivered" && existing.amountDue > 0) throw new Error("No se puede entregar una orden con saldo pendiente");
      if (nextStatus === "delivered" && !existing.diagnosis?.trim()) throw new Error("Registra el diagnóstico antes de entregar la orden");
      if (nextStatus === "delivered" && existing.items.some(i => i.productId && !i.inventoryApplied)) throw new Error("No se puede entregar: hay repuestos pendientes de consumo o devolución");

      const warrantyDays = body.warrantyDays === undefined ? existing.warrantyDays : Number(body.warrantyDays);
      if (!Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) throw new Error("La garantía debe estar entre 0 y 3650 días");
      const notes = body.notes === undefined ? existing.notes : (typeof body.notes === "string" ? body.notes.trim().slice(0, 4000) : "");
      const now = new Date();
      const deliveredAt = nextStatus === "delivered" ? (existing.deliveredAt ?? now) : existing.deliveredAt;
      const warrantyExpiresAt = nextStatus === "delivered" && warrantyDays > 0
        ? new Date(deliveredAt!.getTime() + warrantyDays * 86400000)
        : nextStatus === "delivered" ? null : existing.warrantyExpiresAt;
      const currentMeta = meta(existing.accessories);
      const currentHistory = Array.isArray(currentMeta.statusHistory) ? currentMeta.statusHistory : [];
      const statusChanged = nextStatus !== existing.status;
      const statusHistory = statusChanged ? [...currentHistory, { status: nextStatus, at: now.toISOString(), by: session.id }].slice(-50) : currentHistory;
      const saved = await tx.serviceOrder.update({
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
      return { saved, existingStatus: existing.status, statusChanged, statusHistory };
    });

    await writeAuditLog({ userId: session.id, action: result.statusChanged ? "SERVICE_ORDER_LIFECYCLE_UPDATED" : "SERVICE_ORDER_SCHEDULE_UPDATED", entityType: "ServiceOrder", entityId: id, details: { orderNumber: result.saved.orderNumber, previousStatus: result.existingStatus, status: result.saved.status, estimatedDelivery: result.saved.estimatedDelivery, deliveredAt: result.saved.deliveredAt, warrantyDays: result.saved.warrantyDays, warrantyExpiresAt: result.saved.warrantyExpiresAt, hasNotes: Boolean(result.saved.notes) } });
    return NextResponse.json({ id: result.saved.id, orderNumber: result.saved.orderNumber, status: result.saved.status, estimatedDelivery: result.saved.estimatedDelivery, deliveredAt: result.saved.deliveredAt, warrantyDays: result.saved.warrantyDays, warrantyExpiresAt: result.saved.warrantyExpiresAt, notes: result.saved.notes, statusHistory: result.statusHistory });
  } catch (error: any) {
    console.error("PUT /api/service-orders/lifecycle", error);
    if (error?.message === "Orden no encontrada") return NextResponse.json({ error: error.message }, { status: 404 });
    if (error?.message === "Estado inválido" || error?.message === "Fecha estimada inválida" || error?.message === "La garantía debe estar entre 0 y 3650 días") return NextResponse.json({ error: error.message }, { status: 400 });
    if (error?.message === "Una orden cerrada no puede reabrirse desde el ciclo de vida" || error?.message === "No se puede entregar una orden con saldo pendiente" || error?.message === "Registra el diagnóstico antes de entregar la orden" || error?.message === "No se puede entregar: hay repuestos pendientes de consumo o devolución") return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "No se pudo actualizar el ciclo de vida" }, { status: 500 });
  }
}