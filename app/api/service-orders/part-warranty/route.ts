import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";

const allowed = (session: any) => !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

function metadata(accessories: unknown) {
  return accessories && typeof accessories === "object" && !Array.isArray(accessories) ? accessories as Record<string, any> : {};
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const orderId = new URL(request.url).searchParams.get("orderId")?.trim() ?? "";
  if (!validId(orderId)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });
  try {
    const order = await prisma.serviceOrder.findFirst({ where: { id: orderId, userId: session.id }, include: { items: true } });
    if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    const meta = metadata(order.accessories);
    const warranties = meta.partWarranties ?? {};
    const parts = order.items.map(item => ({ id: item.id, productId: item.productId, name: item.productName, sku: item.sku ?? "", quantity: item.quantity, warrantyDays: Number(warranties[item.id]?.warrantyDays ?? 0), warrantySource: warranties[item.id]?.warrantySource ?? "product_default", warrantyUntil: warranties[item.id]?.warrantyUntil ?? null }));
    return NextResponse.json({ parts });
  } catch (error) {
    console.error("GET /api/service-orders/part-warranty", error);
    return NextResponse.json({ error: "No se pudieron cargar las garantías" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const partId = typeof body.partId === "string" ? body.partId.trim() : "";
    const warrantyDays = Number(body.warrantyDays);
    if (!validId(orderId) || !partId || !Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) return NextResponse.json({ error: "Datos de garantía inválidos" }, { status: 400 });
    const order = await prisma.serviceOrder.findFirst({ where: { id: orderId, userId: session.id }, include: { items: true } });
    if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    if (!order.items.some(item => item.id === partId)) return NextResponse.json({ error: "Repuesto no encontrado" }, { status: 404 });
    const current = metadata(order.accessories);
    const partWarranties = { ...(current.partWarranties ?? {}) };
    const warrantyUntil = warrantyDays > 0 && order.deliveredAt ? new Date(order.deliveredAt.getTime() + warrantyDays * 86400000).toISOString() : null;
    partWarranties[partId] = { warrantyDays, warrantySource: "manual", warrantyUntil, warrantyUpdatedAt: new Date().toISOString(), warrantyUpdatedBy: session.id };
    const saved = await prisma.serviceOrder.update({ where: { id: orderId }, data: { accessories: { ...current, partWarranties }, updatedAt: new Date(), updatedBy: session.id } });
    return NextResponse.json({ parts: order.items.map(item => ({ id: item.id, productId: item.productId, name: item.productName, sku: item.sku ?? "", quantity: item.quantity, warrantyDays: Number(partWarranties[item.id]?.warrantyDays ?? 0), warrantySource: partWarranties[item.id]?.warrantySource ?? "product_default", warrantyUntil: partWarranties[item.id]?.warrantyUntil ?? null })), updatedAt: saved.updatedAt });
  } catch (error) {
    console.error("PUT /api/service-orders/part-warranty", error);
    return NextResponse.json({ error: "No se pudo guardar la garantía" }, { status: 500 });
  }
}
