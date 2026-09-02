/**
 * Stripe Webhook Handler
 * POST /api/payments/webhook — handle Stripe webhook events
 * REQ-0152 / REQ-0209 — incremental amountPaid; sync unpaid|partial|paid;
 * first money confirms + fulfills. Browser return also calls confirm-session (localhost without local webhook).
 * REQ-0217 — partial Stripe refunds reconcile money, inventory and cash safely.
 * REQ-0218 — resolve Stripe payments independently of the order's latest PaymentIntent.
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getStripe, getWebhookSecret, isStripeConfigured, Stripe } from "@/lib/stripe";
import { prisma } from "@/prisma/client";
import { confirmCheckoutSessionById } from "@/lib/payments/confirm-checkout-session";
import { invalidateOnOrderChange } from "@/lib/cache";

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
      case "checkout.session.expired":
        await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
        break;
      case "payment_intent.succeeded":
        logger.info(`PaymentIntent succeeded: ${(event.data.object as Stripe.PaymentIntent).id}`);
        break;
      case "payment_intent.payment_failed":
        logger.warn(`PaymentIntent failed: ${(event.data.object as Stripe.PaymentIntent).id}`);
        break;
      case "charge.refunded":
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
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
 * Stripe's charge.refunded event exposes cumulative amount_refunded, while the
 * Refund list exposes individual refund IDs. We reconcile each successful
 * refund exactly once so Cash never duplicates on webhook retries.
 */
async function handleChargeRefunded(charge: Stripe.Charge) {
  const paymentIntentId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;

  if (!paymentIntentId) {
    logger.warn("Charge refunded but no payment_intent on charge");
    return;
  }

  const paymentMovement = await prisma.cashMovement.findFirst({
    where: {
      source: "sale_payment",
      paymentMethod: "card",
      description: `Pago de Stripe ${paymentIntentId}`,
      status: "active",
    },
    select: { orderId: true, orderNumber: true, userId: true },
  });

  const order = paymentMovement?.orderId
    ? await prisma.order.findUnique({
        where: { id: paymentMovement.orderId },
        include: { items: true, invoice: true },
      })
    : await prisma.order.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
        include: { items: true, invoice: true },
      });

  const invoiceRecord = await prisma.invoice.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    include: { order: { include: { items: true } } },
  });
  const targetOrder = order ?? invoiceRecord?.order;
  const targetInvoice = invoiceRecord ?? order?.invoice;

  if (!targetOrder && !targetInvoice) {
    logger.info(`No Stockly order/invoice found for refunded PaymentIntent ${paymentIntentId}`);
    return;
  }

  const refunds = await getStripe().refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  const successfulRefunds = refunds.data.filter((refund) => refund.status === "succeeded");

  for (const refund of successfulRefunds) {
    const refundAmount = refund.amount / 100;
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) continue;

    try {
      await prisma.$transaction(async (tx) => {
        const refundDescription = `Reembolso de Stripe ${refund.id}`;
        const existingCashMovement = targetOrder
          ? await tx.cashMovement.findFirst({
              where: {
                orderId: targetOrder.id,
                source: "refund",
                paymentMethod: "card",
                description: refundDescription,
                status: "active",
              },
            })
          : null;

        if (existingCashMovement) return;

        const currentInvoice = targetInvoice
          ? await tx.invoice.findUnique({ where: { id: targetInvoice.id } })
          : null;

        let newAmountPaid: number | null = null;
        let fullyRefunded = false;

        if (currentInvoice) {
          const total = Math.max(0, currentInvoice.total);
          const currentPaid = Math.max(0, currentInvoice.amountPaid);
          newAmountPaid = Math.max(0, currentPaid - refundAmount);
          const newAmountDue = Math.max(0, total - newAmountPaid);
          fullyRefunded = newAmountPaid <= 0;

          await tx.invoice.update({
            where: { id: currentInvoice.id },
            data: fullyRefunded
              ? {
                  status: "cancelled",
                  cancelledAt: new Date(),
                  amountPaid: 0,
                  amountDue: 0,
                  paidAt: null,
                  updatedAt: new Date(),
                }
              : {
                  status: "sent",
                  amountPaid: newAmountPaid,
                  amountDue: newAmountDue,
                  paidAt: null,
                  updatedAt: new Date(),
                },
          });
        }

        if (targetOrder && currentInvoice) {
          if (fullyRefunded) {
            const orderUpdate = await tx.order.updateMany({
              where: { id: targetOrder.id, paymentStatus: { not: "refunded" } },
              data: {
                paymentStatus: "refunded",
                status: "cancelled",
                cancelledAt: new Date(),
                updatedAt: new Date(),
              },
            });

            if (orderUpdate.count > 0) {
              for (const item of targetOrder.items) {
                await tx.product.update({
                  where: { id: item.productId },
                  data: { quantity: { increment: item.quantity } },
                });
              }
            }
          } else if (newAmountPaid !== null) {
            await tx.order.update({
              where: { id: targetOrder.id },
              data: {
                paymentStatus: newAmountPaid > 0 ? "partial" : "unpaid",
                updatedAt: new Date(),
              },
            });
          }
        }

        await tx.cashMovement.create({
          data: {
            type: "expense",
            source: "refund",
            amount: refundAmount,
            paymentMethod: "card",
            orderId: targetOrder?.id,
            orderNumber: targetOrder?.orderNumber,
            userId: targetOrder?.userId ?? targetInvoice!.userId,
            createdBy: targetOrder?.userId ?? targetInvoice!.userId,
            description: refundDescription,
            status: "active",
          },
        });
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002") {
        logger.info(`Stripe refund ${refund.id} was already reconciled concurrently`);
        continue;
      }
      throw error;
    }

    logger.info(`Stripe refund ${refund.id} reconciled in cash and payment state: ${refundAmount}`);
  }

  await invalidateOnOrderChange();
}
