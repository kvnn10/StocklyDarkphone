import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const METHODS = ["cash", "card", "transfer", "other"] as const;
type PaymentStatus = "paid" | "partial";
type InvoiceStatus = "paid" | "sent";

const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !["admin", "user", "retailer"].includes(session.role ?? "")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
  const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : "";
  const amount = Number(body.amount);

  if (!validId(invoiceId)) return NextResponse.json({ error: "Factura inválida" }, { status: 400 });
  if (!METHODS.includes(paymentMethod as (typeof METHODS)[number])) return NextResponse.json({ error: "Método de pago inválido" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El valor debe ser mayor que cero" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, userId: session.id },
      });
      if (!invoice) throw Object.assign(new Error("Factura no encontrada"), { status: 404 });
      if (invoice.status === "cancelled") throw Object.assign(new Error("La factura está cancelada"), { status: 409 });

      const total = Math.max(0, Number(invoice.total || 0));
      const paid = Math.max(0, Number(invoice.amountPaid || 0));
      const due = Math.max(0, total - paid);
      if (due <= 0.01) throw Object.assign(new Error("La factura ya está pagada"), { status: 409 });
      if (amount > due + 0.01) throw Object.assign(new Error(`El máximo permitido es ${due.toFixed(2)}`), { status: 400 });

      const now = new Date();
      const newPaid = Math.min(total, paid + amount);
      const newDue = Math.max(0, total - newPaid);
      const paymentStatus: PaymentStatus = newDue <= 0.01 ? "paid" : "partial";
      const invoiceStatus: InvoiceStatus = paymentStatus === "paid" ? "paid" : "sent";

      await tx.salePayment.create({
        data: {
          orderId: invoice.orderId,
          orderNumber: invoice.invoiceNumber,
          userId: session.id,
          recordedBy: session.id,
          amount,
          paymentMethod,
          status: "paid",
          createdAt: now,
        },
      });

      const updatedInvoice = await tx.invoice.updateMany({
        where: { id: invoice.id, userId: session.id, amountPaid: paid },
        data: {
          amountPaid: newPaid,
          amountDue: newDue,
          status: invoiceStatus,
          sentAt: invoice.sentAt ?? now,
          paidAt: paymentStatus === "paid" ? now : null,
          updatedAt: now,
          updatedBy: session.id,
        },
      });
      if (updatedInvoice.count !== 1) {
        throw Object.assign(new Error("La factura cambió mientras se registraba el pago; vuelve a intentarlo"), { status: 409 });
      }

      const updatedOrder = await tx.order.updateMany({
        where: { id: invoice.orderId, userId: session.id },
        data: { paymentStatus, updatedAt: now, updatedBy: session.id },
      });
      if (updatedOrder.count !== 1) {
        throw Object.assign(new Error("No se pudo actualizar el estado de pago de la venta"), { status: 409 });
      }

      await tx.cashMovement.create({
        data: {
          type: "income",
          source: "sale",
          amount,
          paymentMethod,
          orderId: invoice.orderId,
          orderNumber: invoice.invoiceNumber,
          userId: session.id,
          createdBy: session.id,
          description: `Pago factura ${invoice.invoiceNumber}`,
          createdAt: now,
        },
      });

      return { amountPaid: newPaid, amountDue: newDue, paymentStatus, invoiceStatus };
    });

    await writeAuditLog({
      userId: session.id,
      action: "INVOICE_PAYMENT_RECORDED",
      entityType: "Invoice",
      entityId: invoiceId,
      details: {
        amount,
        paymentMethod,
        newPaid: result.amountPaid,
        amountDue: result.amountDue,
        invoiceStatus: result.invoiceStatus,
      },
      userAgent: request.headers.get("user-agent"),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip"),
    });

    return NextResponse.json({
      ok: true,
      amountPaid: result.amountPaid,
      amountDue: result.amountDue,
      paymentStatus: result.paymentStatus,
      invoiceStatus: result.invoiceStatus,
    });
  } catch (error) {
    console.error("POST /api/cash/payments", error);
    const status = typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? Number((error as { status: number }).status)
      : 500;
    const message = error instanceof Error ? error.message : "No se pudo registrar el pago";
    return NextResponse.json({ error: message }, { status });
  }
}
