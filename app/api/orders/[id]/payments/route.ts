import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { getOrderByIdForAdmin, getOrderByIdForProductOwner } from "@/prisma/order";
import { createAuditLog } from "@/prisma/audit-log";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { invalidateOnOrderChange } from "@/lib/cache";

const PAYMENT_METHODS = new Set(["cash", "card", "transfer", "nequi", "daviplata", "other"]);

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function getAccessibleOrder(id: string, session: { id: string; role?: string | null }) {
  if (session.role === "admin") return getOrderByIdForAdmin(id);
  const own = await prisma.order.findFirst({ where: { id, userId: session.id }, select: { id: true } });
  if (own) return prisma.order.findUnique({ where: { id }, include: { items: true, invoice: true } });
  return getOrderByIdForProductOwner(id, session.id);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const order = await getAccessibleOrder(id, session);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const payments = await prisma.salePayment.findMany({
      where: { orderId: id, status: "paid" },
      orderBy: { createdAt: "desc" },
    });
    const total = roundMoney(Number(order.total));
    const paid = roundMoney(payments.reduce((sum, payment) => sum + Number(payment.amount), 0));
    return NextResponse.json({
      orderId: id,
      orderNumber: order.orderNumber,
      total,
      paid: Math.min(total, paid),
      due: Math.max(0, roundMoney(total - paid)),
      paymentStatus: order.paymentStatus,
      payments,
    });
  } catch (error) {
    console.error("Error fetching sale payments:", error);
    return NextResponse.json({ error: "Failed to fetch sale payments" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Only administrators can record sale payments" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const amount = Number(body?.amount);
    const paymentMethod = typeof body?.paymentMethod === "string" ? body.paymentMethod : "";

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Payment amount must be greater than zero" }, { status: 400 });
    }
    if (!PAYMENT_METHODS.has(paymentMethod)) {
      return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
    }

    const order = await getAccessibleOrder(id, session);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.status === "cancelled") return NextResponse.json({ error: "Cancelled orders cannot receive payments" }, { status: 409 });
    if (order.paymentStatus === "refunded") return NextResponse.json({ error: "Refunded orders cannot receive payments" }, { status: 409 });

    const result = await prisma.$transaction(async (tx) => {
      const existingPayments = await tx.salePayment.findMany({
        where: { orderId: id, status: "paid" },
        select: { amount: true },
      });
      const total = roundMoney(Number(order.total));
      const paidBefore = roundMoney(existingPayments.reduce((sum, p) => sum + Number(p.amount), 0));
      const dueBefore = Math.max(0, roundMoney(total - paidBefore));
      if (dueBefore <= 0) throw new Error("Order is already fully paid");
      if (amount > dueBefore + 0.009) throw new Error(`Payment exceeds outstanding balance of ${dueBefore.toFixed(2)}`);

      const payment = await tx.salePayment.create({
        data: {
          orderId: id,
          orderNumber: order.orderNumber,
          userId: order.userId,
          recordedBy: session.id,
          amount: roundMoney(amount),
          paymentMethod,
          status: "paid",
        },
      });

      const paidAfter = roundMoney(paidBefore + amount);
      const dueAfter = Math.max(0, roundMoney(total - paidAfter));
      const paymentStatus = dueAfter <= 0.009 ? "paid" : paidAfter > 0 ? "partial" : "unpaid";

      await tx.order.update({ where: { id }, data: { paymentStatus, updatedAt: new Date() } });

      const existingCash = await tx.cashMovement.findFirst({
        where: { orderId: id, source: "sale_payment", status: "active", description: { contains: payment.id } },
        select: { id: true },
      });
      if (!existingCash) {
        await tx.cashMovement.create({
          data: {
            type: "income", source: "sale_payment", amount: roundMoney(amount), paymentMethod,
            orderId: id, orderNumber: order.orderNumber, userId: order.userId, createdBy: session.id,
            description: `Pago de venta ${order.orderNumber} (${payment.id})`, status: "active",
          },
        });
      }

      const invoice = await tx.invoice.findUnique({ where: { orderId: id } });
      if (invoice) {
        const invoiceDue = Math.max(0, roundMoney(Number(invoice.total) - paidAfter));
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            amountPaid: Math.min(Number(invoice.total), paidAfter), amountDue: invoiceDue,
            status: invoiceDue <= 0.009 ? "paid" : paidAfter > 0 ? "partial" : invoice.status,
            paidAt: invoiceDue <= 0.009 ? new Date() : null, updatedAt: new Date(),
          },
        });
      }

      return { payment, total, paid: paidAfter, due: dueAfter, paymentStatus };
    });

    createAuditLog({
      userId: session.id, action: "create", entityType: "sale_payment", entityId: result.payment.id,
      details: { orderId: id, orderNumber: order.orderNumber, amount: result.payment.amount, paymentMethod, paid: result.paid, due: result.due, paymentStatus: result.paymentStatus },
    }).catch(() => {});

    await invalidateOnOrderChange();
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record sale payment";
    const status = /already fully paid|exceeds outstanding/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
