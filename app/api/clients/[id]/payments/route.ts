import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const ROLES = ["admin", "user", "retailer"] as const;
const methods = ["cash", "card", "transfer", "nequi", "daviplata", "other"];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as (typeof ROLES)[number])) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id: clientId } = await params;
  if (!ObjectId.isValid(clientId)) return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
  try {
    const body = await request.json();
    const type = body.type === "repair" ? "repair" : "sale";
    const documentId = typeof body.documentId === "string" ? body.documentId : "";
    const amount = Number(body.amount);
    const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : "";
    if (!documentId || !Number.isFinite(amount) || amount <= 0 || !methods.includes(paymentMethod)) return NextResponse.json({ error: "Datos de abono inválidos" }, { status: 400 });

    if (type === "sale") {
      const order = await prisma.order.findFirst({ where: { id: documentId, userId: session.id, clientId, status: { not: "cancelled" } }, select: { id: true, orderNumber: true, total: true } });
      if (!order) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
      const previous = await prisma.salePayment.aggregate({ _sum: { amount: true }, where: { orderId: order.id, status: "paid" } });
      const paid = Number(previous._sum.amount || 0), balance = Math.max(0, Number(order.total || 0) - paid);
      if (amount > balance + 0.009) return NextResponse.json({ error: `El abono supera el saldo pendiente (${balance.toLocaleString("es-CO")})` }, { status: 400 });
      await prisma.$transaction(async tx => {
        const now = new Date();
        await tx.salePayment.create({ data: { orderId: order.id, orderNumber: order.orderNumber, userId: session.id, recordedBy: session.id, amount, paymentMethod, status: "paid", createdAt: now } });
        const newPaid = paid + amount;
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: newPaid >= Number(order.total || 0) - 0.009 ? "paid" : "partial", updatedAt: now, updatedBy: session.id } });
        const invoice = await tx.invoice.findFirst({ where: { orderId: order.id, userId: session.id }, select: { id: true } });
        if (invoice) {
          const invoicePaid = Math.min(Number(order.total || 0), newPaid);
          const invoiceDue = Math.max(0, Number(order.total || 0) - invoicePaid);
          await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: invoicePaid, amountDue: invoiceDue, status: invoiceDue <= 0.01 ? "paid" : "sent", paidAt: invoiceDue <= 0.01 ? now : null, updatedAt: now, updatedBy: session.id } });
        }
        await tx.cashMovement.create({ data: { type: "income", source: "sale_payment", amount, paymentMethod, orderId: order.id, orderNumber: order.orderNumber, userId: session.id, createdBy: session.id, description: `Abono ${order.orderNumber}`, createdAt: now } });
      });
    } else {
      const order = await prisma.serviceOrder.findFirst({ where: { id: documentId, userId: session.id, clientId, status: { not: "cancelled" } }, select: { id: true, orderNumber: true, total: true } });
      if (!order) return NextResponse.json({ error: "Reparación no encontrada" }, { status: 404 });
      const previous = await prisma.serviceOrderPayment.aggregate({ _sum: { amount: true }, where: { serviceOrderId: order.id, status: "paid" } });
      const paid = Number(previous._sum.amount || 0), balance = Math.max(0, Number(order.total || 0) - paid);
      if (amount > balance + 0.009) return NextResponse.json({ error: `El abono supera el saldo pendiente (${balance.toLocaleString("es-CO")})` }, { status: 400 });
      await prisma.$transaction(async tx => {
        const now = new Date();
        await tx.serviceOrderPayment.create({ data: { serviceOrderId: order.id, userId: session.id, recordedBy: session.id, amount, paymentMethod, status: "paid", createdAt: now } });
        await tx.serviceOrder.update({ where: { id: order.id }, data: { amountPaid: paid + amount, amountDue: Math.max(0, Number(order.total || 0) - paid - amount), updatedAt: now, updatedBy: session.id } });
        await tx.cashMovement.create({ data: { type: "income", source: "service_payment", amount, paymentMethod, orderId: order.id, orderNumber: order.orderNumber, userId: session.id, createdBy: session.id, description: `Abono ${order.orderNumber}`, createdAt: now } });
      });
    }
    await writeAuditLog({ userId: session.id, action: "CLIENT_PAYMENT_RECORDED", entityType: type === "sale" ? "Order" : "ServiceOrder", entityId: documentId, details: { clientId, amount, paymentMethod } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST /api/clients/[id]/payments", error);
    return NextResponse.json({ error: "No se pudo registrar el abono" }, { status: 500 });
  }
}
