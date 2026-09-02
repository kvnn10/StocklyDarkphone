/**
 * REQ-0209 gap — Apply Stripe Checkout Session on browser return (`?payment=success&session_id=`).
 * REQ-0215 — incremental amountPaid; sync unpaid|partial|paid.
 * REQ-0216 — serialize Stripe payment application so concurrent partial checkouts
 * cannot overpay an invoice or apply the same PaymentIntent twice.
 * REQ-0217 — persist every Stripe charge in SalePayment + Caja atomically.
 */

import { getStripe } from "@/lib/stripe";
import { prisma } from "@/prisma/client";
import { applyIncrementalInvoicePayment } from "@/lib/payments/order-payment-from-amounts";
import { healInvoiceStatusAfterMoney } from "@/lib/invoices/heal-invoice-status-after-money";
import { resolveInvoiceBillingAddressInput } from "@/lib/invoices/resolve-invoice-billing-address";
import { generateInvoiceNumber } from "@/prisma/invoice";
import { invalidateOnOrderChange } from "@/lib/cache";
import { createStripeRefund } from "@/lib/stripe/refund";
import { logger } from "@/lib/logger";

export type ConfirmCheckoutSessionResult = {
  ok: boolean;
  alreadyApplied: boolean;
  orderId?: string;
  invoiceId?: string;
  paymentStatus?: string | null;
  orderStatus?: string | null;
  invoiceStatus?: string | null;
  error?: string;
};

class PaymentExceedsDueError extends Error {
  constructor() {
    super("Stripe payment exceeds the remaining balance");
    this.name = "PaymentExceedsDueError";
  }
}

async function runPaymentTransaction<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== "P2034" || attempt === 3) throw error;
      logger.warn("Retrying concurrent Stripe payment transaction", { attempt });
    }
  }
  throw new Error("Stripe payment transaction failed");
}

async function refundExcessStripePayment(paymentIntentId: string): Promise<void> {
  try {
    await createStripeRefund(paymentIntentId, "requested_by_customer");
    logger.warn("Stripe payment refunded because it exceeded the remaining balance", {
      paymentIntentId,
    });
  } catch (error) {
    logger.error("Failed to refund Stripe overpayment", { paymentIntentId, error });
    throw error;
  }
}

export async function confirmCheckoutSessionById(
  sessionId: string,
): Promise<ConfirmCheckoutSessionResult> {
  if (!sessionId.startsWith("cs_")) {
    return { ok: false, alreadyApplied: false, error: "Invalid session id" };
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") {
    return {
      ok: false,
      alreadyApplied: false,
      error: `Session not paid (${session.payment_status})`,
    };
  }

  const metadata = session.metadata ?? {};
  const type = metadata.type;
  const referenceId = metadata.referenceId;
  const orderIdMeta = metadata.orderId;
  const invoiceIdMeta = metadata.invoiceId;
  const sessionAmount = session.amount_total ? session.amount_total / 100 : 0;
  const metaCharge = metadata.chargeAmount
    ? Number.parseFloat(metadata.chargeAmount)
    : NaN;
  const chargeAmount =
    Number.isFinite(metaCharge) && metaCharge > 0 ? metaCharge : sessionAmount;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!paymentIntentId) {
    return { ok: false, alreadyApplied: false, error: "Missing Stripe payment intent" };
  }

  if (type === "order" && (orderIdMeta || referenceId)) {
    const orderId = orderIdMeta || referenceId!;
    try {
      const applied = await runPaymentTransaction(async () =>
        prisma.$transaction(async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            include: { invoice: true },
          });
          if (!order) throw new Error("Order not found");

          if (order.stripePaymentIntentId === paymentIntentId) {
            return { alreadyApplied: true, invoiceId: order.invoice?.id };
          }

          const invoice = order.invoice;
          const currentDue = invoice?.amountDue ?? order.total;
          const dueCents = Math.round(Math.max(0, currentDue) * 100);
          const chargeCents = Math.round(Math.max(0, chargeAmount) * 100);
          if (chargeCents <= 0 || chargeCents > dueCents) {
            throw new PaymentExceedsDueError();
          }

          let invoiceId: string;
          if (invoice) {
            const next = applyIncrementalInvoicePayment({
              priorAmountPaid: invoice.amountPaid,
              total: invoice.total,
              chargeAmount,
              priorStatus: invoice.status,
            });
            const updated = await tx.invoice.update({
              where: { id: invoice.id },
              data: {
                status: next.status,
                amountPaid: next.amountPaid,
                amountDue: next.amountDue,
                paidAt: next.fullyPaid ? new Date() : null,
                stripePaymentIntentId: paymentIntentId,
                updatedAt: new Date(),
              },
            });
            invoiceId = updated.id;
          } else {
            const now = new Date();
            const next = applyIncrementalInvoicePayment({
              priorAmountPaid: 0,
              total: order.total,
              chargeAmount,
              priorStatus: "sent",
            });
            const invoiceNumber = await generateInvoiceNumber();
            const created = await tx.invoice.create({
              data: {
                invoiceNumber,
                orderId,
                userId: order.userId,
                clientId: order.clientId,
                status: next.status,
                subtotal: order.subtotal,
                tax: order.tax && order.tax > 0 ? order.tax : null,
                shipping: order.shipping && order.shipping > 0 ? order.shipping : null,
                discount: order.discount && order.discount > 0 ? order.discount : null,
                total: order.total,
                amountPaid: next.amountPaid,
                amountDue: next.amountDue,
                dueDate: now,
                issuedAt: now,
                sentAt: now,
                paidAt: next.fullyPaid ? now : null,
                cancelledAt: null,
                paymentLink: null,
                notes: next.fullyPaid
                  ? "Auto-generated when order was paid via Stripe."
                  : "Auto-generated from Stripe partial payment on order.",
                billingAddress: resolveInvoiceBillingAddressInput(order),
                createdBy: order.userId,
                updatedBy: null,
                createdAt: now,
                updatedAt: null,
                stripePaymentIntentId: paymentIntentId,
              },
            });
            invoiceId = created.id;
          }

          await tx.order.update({
            where: { id: orderId },
            data: {
              stripePaymentIntentId: paymentIntentId,
              updatedAt: new Date(),
            },
          });

          await tx.salePayment.create({
            data: {
              orderId,
              orderNumber: order.orderNumber,
              userId: order.userId,
              recordedBy: order.userId,
              amount: chargeAmount,
              paymentMethod: "card",
              status: "paid",
              createdAt: new Date(),
            },
          });

          await tx.cashMovement.create({
            data: {
              type: "income",
              source: "sale_payment",
              amount: chargeAmount,
              paymentMethod: "card",
              orderId,
              orderNumber: order.orderNumber,
              userId: order.userId,
              createdBy: order.userId,
              description: "Pago de venta vía Stripe",
              status: "active",
              createdAt: new Date(),
            },
          });

          return { alreadyApplied: false, invoiceId };
        }),
      );

      const invoiceStatus = applied.invoiceId
        ? (await healInvoiceStatusAfterMoney(applied.invoiceId))?.status ?? null
        : null;
      await invalidateOnOrderChange();
      const refreshed = await prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true, paymentStatus: true },
      });

      return {
        ok: true,
        alreadyApplied: applied.alreadyApplied,
        orderId,
        invoiceId: applied.invoiceId,
        paymentStatus: refreshed?.paymentStatus ?? null,
        orderStatus: refreshed?.status ?? null,
        invoiceStatus,
      };
    } catch (error) {
      if (error instanceof PaymentExceedsDueError) {
        await refundExcessStripePayment(paymentIntentId);
        return {
          ok: false,
          alreadyApplied: false,
          orderId,
          error: "Stripe payment exceeded the remaining balance and was refunded",
        };
      }
      if (error instanceof Error && error.message === "Order not found") {
        return { ok: false, alreadyApplied: false, error: error.message };
      }
      throw error;
    }
  }

  if (type === "invoice" && (invoiceIdMeta || referenceId)) {
    const invoiceId = invoiceIdMeta || referenceId!;
    try {
      const applied = await runPaymentTransaction(async () =>
        prisma.$transaction(async (tx) => {
          const invoice = await tx.invoice.findUnique({
            where: { id: invoiceId },
            include: { order: true },
          });
          if (!invoice) throw new Error("Invoice not found");

          if (invoice.stripePaymentIntentId === paymentIntentId) {
            return { alreadyApplied: true, orderId: invoice.orderId };
          }

          const dueCents = Math.round(Math.max(0, invoice.amountDue) * 100);
          const chargeCents = Math.round(Math.max(0, chargeAmount) * 100);
          if (chargeCents <= 0 || chargeCents > dueCents) {
            throw new PaymentExceedsDueError();
          }

          const next = applyIncrementalInvoicePayment({
            priorAmountPaid: invoice.amountPaid,
            total: invoice.total,
            chargeAmount,
            priorStatus: invoice.status,
          });
          await tx.invoice.update({
            where: { id: invoiceId },
            data: {
              status: next.status,
              amountPaid: next.amountPaid,
              amountDue: next.amountDue,
              paidAt: next.fullyPaid ? new Date() : null,
              stripePaymentIntentId: paymentIntentId,
              updatedAt: new Date(),
            },
          });

          if (invoice.order) {
            await tx.salePayment.create({
              data: {
                orderId: invoice.order.id,
                orderNumber: invoice.order.orderNumber,
                userId: invoice.order.userId,
                recordedBy: invoice.order.userId,
                amount: chargeAmount,
                paymentMethod: "card",
                status: "paid",
                createdAt: new Date(),
              },
            });

            await tx.cashMovement.create({
              data: {
                type: "income",
                source: "sale_payment",
                amount: chargeAmount,
                paymentMethod: "card",
                orderId: invoice.order.id,
                orderNumber: invoice.order.orderNumber,
                userId: invoice.order.userId,
                createdBy: invoice.order.userId,
                description: "Pago de factura vía Stripe",
                status: "active",
                createdAt: new Date(),
              },
            });
          }

          return { alreadyApplied: false, orderId: invoice.orderId };
        }),
      );

      const healed = await healInvoiceStatusAfterMoney(invoiceId);
      await invalidateOnOrderChange();
      const refreshed = applied.orderId
        ? await prisma.order.findUnique({
            where: { id: applied.orderId },
            select: { status: true, paymentStatus: true },
          })
        : null;

      return {
        ok: true,
        alreadyApplied: applied.alreadyApplied,
        invoiceId,
        orderId: applied.orderId,
        paymentStatus: refreshed?.paymentStatus ?? null,
        orderStatus: refreshed?.status ?? null,
        invoiceStatus: healed?.status ?? null,
      };
    } catch (error) {
      if (error instanceof PaymentExceedsDueError) {
        await refundExcessStripePayment(paymentIntentId);
        return {
          ok: false,
          alreadyApplied: false,
          invoiceId,
          error: "Stripe payment exceeded the remaining balance and was refunded",
        };
      }
      if (error instanceof Error && error.message === "Invoice not found") {
        return { ok: false, alreadyApplied: false, error: error.message };
      }
      throw error;
    }
  }

  logger.warn("confirmCheckoutSession: unknown session type", {
    type,
    sessionId,
  });
  return { ok: false, alreadyApplied: false, error: "Unknown checkout type" };
}
