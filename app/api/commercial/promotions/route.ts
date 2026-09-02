import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";
import { getPromotions, savePromotions, type Promotion, type PromotionType } from "@/lib/commercial/pricing";

const TYPES = new Set<PromotionType>(["price", "2x1", "3x2", "quantity"]);
const adminOnly = (role?: string | null) => role === "admin";

function normalize(body: Record<string, unknown>, current?: Promotion): Promotion {
  const type = (body.type ?? current?.type) as PromotionType;
  const name = String(body.name ?? current?.name ?? "").trim();
  const value = Number(body.value ?? current?.value ?? 0);
  const minQuantityRaw = body.minQuantity ?? current?.minQuantity ?? null;
  const minQuantity = minQuantityRaw == null ? null : Number(minQuantityRaw);
  const startsAt = String(body.startsAt ?? current?.startsAt ?? "");
  const endsAt = String(body.endsAt ?? current?.endsAt ?? "");
  if (!name || !TYPES.has(type) || !Number.isFinite(value) || value < 0) throw new Error("Datos de promoción inválidos");
  if (type === "quantity" && (!Number.isInteger(minQuantity) || (minQuantity as number) < 2)) throw new Error("La promoción por cantidad requiere mínimo 2 unidades");
  const start = new Date(startsAt); const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new Error("Rango de fechas inválido");
  return {
    id: current?.id ?? randomUUID(), name, type,
    productId: body.productId === undefined ? (current?.productId ?? null) : (body.productId ? String(body.productId) : null),
    value, minQuantity,
    startsAt: start.toISOString(), endsAt: end.toISOString(),
    active: body.active === undefined ? (current?.active ?? true) : Boolean(body.active),
    priority: Number.isFinite(Number(body.priority ?? current?.priority ?? 0)) ? Number(body.priority ?? current?.priority ?? 0) : 0,
    stackable: body.stackable === undefined ? (current?.stackable ?? false) : Boolean(body.stackable),
  };
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const promotions = await getPromotions(session.id);
  const activeOnly = request.nextUrl.searchParams.get("active") === "true";
  return NextResponse.json(activeOnly ? promotions.filter((p) => p.active) : promotions);
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!adminOnly(session.role)) return NextResponse.json({ error: "Solo administradores pueden crear promociones" }, { status: 403 });
  try {
    const promotions = await getPromotions(session.id);
    const promotion = normalize(await request.json(), undefined);
    promotions.push(promotion);
    await savePromotions(session.id, promotions, session.id);
    await writeAuditLog({ userId: session.id, action: "create", entityType: "SystemConfig", details: { type: "promotion", promotion } });
    return NextResponse.json(promotion, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear la promoción" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!adminOnly(session.role)) return NextResponse.json({ error: "Solo administradores pueden modificar promociones" }, { status: 403 });
  try {
    const body = await request.json(); const id = String(body.id ?? ""); const promotions = await getPromotions(session.id);
    const index = promotions.findIndex((p) => p.id === id);
    if (index < 0) return NextResponse.json({ error: "Promoción no encontrada" }, { status: 404 });
    const before = promotions[index]; const promotion = normalize(body, before); promotions[index] = promotion;
    await savePromotions(session.id, promotions, session.id);
    await writeAuditLog({ userId: session.id, action: "update", entityType: "SystemConfig", details: { type: "promotion", before, after: promotion } });
    return NextResponse.json(promotion);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la promoción" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!adminOnly(session.role)) return NextResponse.json({ error: "Solo administradores pueden eliminar promociones" }, { status: 403 });
  try {
    const id = request.nextUrl.searchParams.get("id") ?? ""; const promotions = await getPromotions(session.id);
    const removed = promotions.find((p) => p.id === id);
    if (!removed) return NextResponse.json({ error: "Promoción no encontrada" }, { status: 404 });
    await savePromotions(session.id, promotions.filter((p) => p.id !== id), session.id);
    await writeAuditLog({ userId: session.id, action: "delete", entityType: "SystemConfig", details: { type: "promotion", promotion: removed } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo eliminar la promoción" }, { status: 400 });
  }
}
