import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { getSessionFromRequest as sessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const MAX_PHOTOS = 12;
const MAX_DATA_URL = 900_000;
const STAGES = ["ingreso", "reparacion", "entrega"] as const;
type Stage = (typeof STAGES)[number];
const allowed = (session: any) => !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const metadata = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json();
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  const filename = typeof body.filename === "string" ? body.filename : "evidencia.jpg";
  const stage = STAGES.includes(body.stage) ? (body.stage as Stage) : "ingreso";
  if (!validId(orderId) || !dataUrl.startsWith("data:image/")) return NextResponse.json({ error: "Fotografía inválida" }, { status: 400 });
  if (dataUrl.length > MAX_DATA_URL) return NextResponse.json({ error: "La fotografía comprimida sigue siendo demasiado grande" }, { status: 400 });
  try {
    const order = await prisma.serviceOrder.findFirst({ where: { id: orderId, userId: session.id } });
    if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    if (["delivered", "cancelled"].includes(order.status)) return NextResponse.json({ error: "La orden está cerrada" }, { status: 409 });
    const current = metadata(order.accessories);
    const photos = Array.isArray(current.photos) ? [...current.photos] : [];
    if (photos.length >= MAX_PHOTOS) return NextResponse.json({ error: `Máximo ${MAX_PHOTOS} fotografías por orden` }, { status: 400 });
    const photo = { id: crypto.randomUUID(), url: dataUrl, filename, category: stage, stage, uploadedAt: new Date().toISOString(), uploadedBy: session.id };
    await prisma.serviceOrder.update({ where: { id: orderId }, data: { accessories: { ...current, photos: [...photos, photo] }, updatedAt: new Date(), updatedBy: session.id } });
    await writeAuditLog({ userId: session.id, action: "SERVICE_ORDER_PHOTO_ADDED", entityType: "ServiceOrder", entityId: orderId, details: { photoId: photo.id, filename, stage } });
    return NextResponse.json({ photo });
  } catch (error) {
    console.error("POST /api/service-orders/photos", error);
    return NextResponse.json({ error: "No se pudo guardar la fotografía" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await sessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json();
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const photoId = typeof body.photoId === "string" ? body.photoId : "";
  if (!validId(orderId) || !photoId) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const order = await prisma.serviceOrder.findFirst({ where: { id: orderId, userId: session.id } });
    if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    if (["delivered", "cancelled"].includes(order.status)) return NextResponse.json({ error: "La orden está cerrada" }, { status: 409 });
    const current = metadata(order.accessories);
    const photos = Array.isArray(current.photos) ? current.photos : [];
    const nextPhotos = photos.filter((photo: any) => String(photo?.id) !== photoId);
    if (nextPhotos.length === photos.length) return NextResponse.json({ error: "Fotografía no encontrada" }, { status: 404 });
    await prisma.serviceOrder.update({ where: { id: orderId }, data: { accessories: { ...current, photos: nextPhotos }, updatedAt: new Date(), updatedBy: session.id } });
    await writeAuditLog({ userId: session.id, action: "SERVICE_ORDER_PHOTO_REMOVED", entityType: "ServiceOrder", entityId: orderId, details: { photoId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/service-orders/photos", error);
    return NextResponse.json({ error: "No se pudo eliminar la fotografía" }, { status: 500 });
  }
}
