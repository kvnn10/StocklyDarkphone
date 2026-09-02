/**
 * Stripe Webhook Handler
 * POST /api/payments/webhook — handle Stripe webhook events
 * REQ-0152 / REQ-0209 — incremental amountPaid; sync unpaid|partial|paid;
 * first money confirms + fulfills. Browser return also calls confirm-session (localhost without local webhook).
 * REQ-0217 — refund reconciliation is cumulative and partial-refund safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  getStripe,
  getWebhookSecret,
  isStripeConfigured,
  Stripe,
} from "@/lib/stripe";
import { prisma } from "@/prisma/client";
import { confirmCheckoutSessionById } from "@/lib/payments/confirm-checkout-session";
import { invalidateOnOrderChange } from "@/lib/cache";
import { syncOrderPaymentStatusFromInvoice } from "@/lib/payments/order-payment-from-amounts";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      logger.warn("Stripe webhook received but Stripe is not configured");
      return NextResponse.json({ error: "Payment system is not configured" }, { status: 503 });
    }

    const stripe = getStripe();
    const webhookSecret = getWebhookSecret();
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      logger.error("Missing Stripe signature header");
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      logger.error("Webhook signature verification failed:", err);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    logger.info(`Received Stripe webhook: ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.id) {
          const result = await confirmCheckoutSessionById(session.id);
          if (!result.ok) {
            logger.warn("Webhook confirm-session failed", { error: result.error, sessionId: session.id });
            throw new Error(result.error ?? "confirm-session failed");
          }
          logger.info(`Checkout completed synced order=${result.orderId} status=${result.orderStatus} pay=${result.paymentStatus} alreadyApplied=${result.alreadyApplied}`);
        }
        break;
      }
      case "checkout.session.expired": {
        await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
        break;
      }
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        logger.info(`PaymentIntent succeeded: ${paymentIntent.id}`);
        break;
      }
      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        logger.warn(`PaymentIntent failed: ${paymentIntent.id}`);
        break;
      }
      case "charge.refunded": {
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      }
      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error("Webhook handler error:", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session) {
  const metadata = session.metadata;
  if (!metadata) return;
  const { type, orderId, invoiceId, referenceId } = metadata;
  logger.info(`Checkout expired for ${type} ${referenceId || orderId || invoiceId}`);
}

/**
 * Reconcile the cumulative Stripe refund state.
 * A partial refund updates money only; a full refund cancels and restores stock once.
 * The state transitions are conditional so Stripe retries cannot duplicate inventory.
 */
async function handleChargeRefunded(charge: Stripe.Charge) {
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;

  if (!paymentIntentId) {
    logger.warn("Charge refunded but no payment_intent on charge");
    return;
  }

  const refundedCents = Math.max(0, charge.amount_refunded ?? 0);
  const chargeCents = Math.max(0, charge.amount ?? 0);
  const isFullRefund = chargeCents > 0 && refundedCents >= chargeCents;
  const refundedAmount = refundedCents / 100;

  logger.info(`Charge refund reconciliation: ${charge.id}, PaymentIntent=${paymentIntentId}, refunded=${refundedAmount}, full=${isFullRefund}`);

  const order = await prisma.order.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    include: { items: true, invoice: true },
  });

  const invoiceRecord = await prisma.invoice.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    include: { order: { include: { items: true } } },
  });

  if (!order && !invoiceRecord) {
    logger.info(`No Stockly order/invoice found for refunded PaymentIntent ${paymentIntentId}`);
    return;
  }

  if (isFullRefund) {
    await prisma.$transaction(async (tx) => {
      const targetOrder = order ?? invoiceRecord?.order;
      const targetInvoice = invoiceRecord ?? order?.invoice;

      if (targetOrder) {
        const updated = await tx.order.updateMany({
          where: { id: targetOrder.id, paymentStatus: { not: "refunded" } },
          data: { paymentStatus: "refunded", status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() },
        });

        if (updated.count > 0) {
          for (const item of targetOrder.items) {
            await tx.product.update({ where: { id: item.productId }, data: { quantity: { increment: item.quantity } } });
          }
        }
      }

      if (targetInvoice) {
        await tx.invoice.updateMany({
          where: { id: targetInvoice.id, status: { not: "cancelled" } },
          data: { status: "cancelled", cancelledAt: new Date(), amountPaid: 0, amountDue: 0, updatedAt: new Date() },
        });
      }
    });

    logger.info(`Full Stripe refund reconciled for PaymentIntent ${paymentIntentId}`);
  } else if (refundedCents > 0) {
    const targetInvoice = invoiceRecord ?? order?.invoice;
    if (targetInvoice) {
      const originalPaid = Math.max(0, targetInvoice.amountPaid);
      const remainingPaid = Math.max(0, originalPaid - refundedAmount);
      const total = Math.max(0, targetInvoice.total);
      const remainingDue = Math.max(0, total - remainingPaid);

      await prisma.$transaction(async (tx) => {
        await tx.invoice.updateMany({
          where: { id: targetInvoice.id, status: { not: "cancelled" } },
          data: {
            amountPaid: remainingPaid,
            amountDue: remainingDue,
            status: remainingPaid >= total && total > 0 ? "paid" : remainingPaid > 0 ? "sent" : "sent",
            paidAt: remainingPaid >= total && total > 0 ? (targetInvoice.paidAt ?? new Date()) : null,
            updatedAt: new Date(),
          },
        });
      });

      await syncOrderPaymentStatusFromInvoice(targetInvoice.orderId, {
        amountPaid: remainingPaid,
        total,
        invoiceStatus: remainingPaid >= total && total > 0 ? "paid" : "sent",
      });

      logger.info(`Partial Stripe refund reconciled for PaymentIntent ${paymentIntentId}: ${refundedAmount}`);
    } else {
      logger.warn(`Partial Stripe refund received without a linked invoice for PaymentIntent ${paymentIntentId}`);
    }
  }

  await invalidateOnOrderChange();
}
