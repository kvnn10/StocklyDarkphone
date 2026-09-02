import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const order = await prisma.order.findFirst({ where: { id, userId: session.id }, select: { id: true } });
  if (!order) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
  const logs = await prisma.auditLog.findMany({ where: { entityType: "Order", entityId: id, action: "ORDER_CHANGE" }, orderBy: { createdAt: "desc" }, take: 100 });
  return NextResponse.json(logs.map((log) => ({ id: log.id, createdAt: log.createdAt.toISOString(), userId: log.userId, details: log.details })));
}
