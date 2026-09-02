import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const TYPES = ["income", "expense"] as const;
const METHODS = ["cash", "card", "transfer", "other"] as const;
const SOURCES = ["sale", "repair", "manual", "refund"] as const;
const ROLES = ["admin", "user", "retailer"] as const;
const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const parseDate = (value: string | null) => { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; };

function serializeMovement(movement: any) { return { ...movement, _id: movement.id, voidedAt: movement.voidedAt?.toISOString() ?? null, createdAt: movement.createdAt.toISOString() }; }

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as (typeof ROLES)[number])) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const p = request.nextUrl.searchParams;
    const from = parseDate(p.get("from")); const to = parseDate(p.get("to"));
    if (from && to && from > to) return NextResponse.json({ error: "El rango de fechas es inválido" }, { status: 400 });
    const type = p.get("type") || ""; const method = p.get("method") || ""; const source = p.get("source") || "";
    if (type && !TYPES.includes(type as any)) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
    if (method && !METHODS.includes(method as any)) return NextResponse.json({ error: "Medio inválido" }, { status: 400 });
    if (source && !SOURCES.includes(source as any)) return NextResponse.json({ error: "Origen inválido" }, { status: 400 });
    const movements = await prisma.cashMovement.findMany({ where: { userId: session.id, ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}), ...(type ? { type } : {}), ...(method ? { paymentMethod: method } : {}), ...(source ? { source } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
    const saleOrderIds = movements.filter(m => m.source === "sale" && m.orderId).map(m => m.orderId as string);
    const cancelledOrderIds = new Set<string>();
    if (saleOrderIds.length) {
      const orders = await prisma.order.findMany({ where: { id: { in: saleOrderIds }, userId: session.id, OR: [{ status: "cancelled" }, { paymentStatus: "refunded" }] }, select: { id: true } });
      orders.forEach(o => cancelledOrderIds.add(o.id));
    }
    const normalized = movements.map(m => {
      const cancelled = m.source === "sale" && m.orderId && cancelledOrderIds.has(m.orderId);
      if (!cancelled || m.status === "voided") return serializeMovement(m);
      return serializeMovement({ ...m, status: "voided", voidedAt: m.voidedAt ?? new Date(), voidReason: m.voidReason ?? "Venta cancelada o reembolsada" });
    });
    const active = normalized.filter(m => m.status !== "voided");
    const income = active.filter(m => m.type === "income").reduce((s,m) => s + Number(m.amount || 0), 0);
    const expense = active.filter(m => m.type === "expense").reduce((s,m) => s + Number(m.amount || 0), 0);
    const bySource: Record<string, number> = {};
    active.filter(m => m.type === "income").forEach(m => { bySource[m.source] = (bySource[m.source] || 0) + Number(m.amount || 0); });
    return NextResponse.json({ movements: normalized, summary: { income, expense, refunds: active.filter(m => m.source === "refund").reduce((s,m) => s + Number(m.amount || 0), 0), balance: income - expense, bySource }, filters: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null, type, method, source } });
  } catch (error) { console.error("GET /api/cash", error); return NextResponse.json({ error: "No se pudieron obtener los movimientos" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request); if (!session || !ROLES.includes(session.role as any)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    if (!TYPES.includes(body.type) || !METHODS.includes(body.paymentMethod)) return NextResponse.json({ error: "Tipo o método de pago inválido" }, { status: 400 });
    const amount = Number(body.amount); if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El valor debe ser mayor que cero" }, { status: 400 });
    const orderId = typeof body.orderId === "string" && body.orderId.trim() ? body.orderId.trim() : null; if (orderId && !validId(orderId)) return NextResponse.json({ error: "ID de venta inválido" }, { status: 400 });
    const result = await prisma.$transaction(async tx => {
      if (orderId) {
        const order = await tx.order.findFirst({ where: { id: orderId, userId: session.id } }); if (!order) throw Object.assign(new Error("Venta no encontrada o no autorizada"), { status: 404 });
        if (order.status === "cancelled" || order.paymentStatus === "refunded") throw Object.assign(new Error("No se puede registrar Caja para una venta cancelada o reembolsada"), { status: 409 });
        const existing = await tx.cashMovement.findFirst({ where: { userId: session.id, orderId, source: "sale", status: { not: "voided" } } }); if (existing) return { movement: existing, created: false };
      }
      const movement = await tx.cashMovement.create({ data: { type: body.type, source: orderId ? "sale" : "manual", orderId, amount, paymentMethod: body.paymentMethod, userId: session.id, createdBy: session.id, description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : orderId ? "Venta" : "Movimiento manual", status: "active", createdAt: new Date() } });
      return { movement, created: true };
    });
    if (result.created) await writeAuditLog({ userId: session.id, action: "CASH_MOVEMENT_CREATED", entityType: "CashMovement", entityId: result.movement.id, details: { type: result.movement.type, source: result.movement.source, amount: result.movement.amount, paymentMethod: result.movement.paymentMethod, orderId: result.movement.orderId ?? null, description: result.movement.description }, userAgent: request.headers.get("user-agent"), ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip") });
    return NextResponse.json(serializeMovement(result.movement), { status: result.created ? 201 : 200 });
  } catch (error) { const status = typeof error === "object" && error !== null && "status" in error ? Number((error as any).status) : 500; return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo registrar el movimiento" }, { status }); }
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request); if (!session || !ROLES.includes(session.role as any)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})); const id = typeof body.id === "string" ? body.id.trim() : ""; if (!validId(id)) return NextResponse.json({ error: "Movimiento inválido" }, { status: 400 });
    const result = await prisma.$transaction(async tx => { const movement = await tx.cashMovement.findFirst({ where: { id, userId: session.id } }); if (!movement) throw Object.assign(new Error("Movimiento no encontrado"), { status: 404 }); if (movement.status === "voided") throw Object.assign(new Error("El movimiento ya está anulado"), { status: 409 }); return tx.cashMovement.update({ where: { id }, data: { status: "voided", voidedAt: new Date(), voidedBy: session.id, voidReason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "Movimiento anulado manualmente" } }); });
    await writeAuditLog({ userId: session.id, action: "CASH_MOVEMENT_VOIDED", entityType: "CashMovement", entityId: id, details: { type: result.type, source: result.source, amount: result.amount, paymentMethod: result.paymentMethod, orderId: result.orderId ?? null, reason: result.voidReason }, userAgent: request.headers.get("user-agent"), ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip") });
    return NextResponse.json({ ok: true, message: "Movimiento anulado correctamente" });
  } catch (error) { const status = typeof error === "object" && error !== null && "status" in error ? Number((error as any).status) : 500; return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo anular el movimiento" }, { status }); }
}
