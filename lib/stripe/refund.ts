/**
 * Stripe Refund Utilities
 * Used when cancelling/refunding paid orders or invoices
 */

import { logger } from "@/lib/logger";
import { getStripe, isStripeConfigured } from "./server";

export async function createStripeRefund(
  paymentIntentId: string,
  reason?: "duplicate" | "fraudulent" | "requested_by_customer",
  amount?: number,
): Promise<{ id: string } | null> {
  if (!isStripeConfigured()) {
    logger.warn("Stripe refund skipped: Stripe is not configured");
    return null;
  }

  if (!paymentIntentId) {
    logger.warn("Stripe refund skipped: no payment intent ID");
    return null;
  }

  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
    throw new Error("Invalid Stripe refund amount");
  }

  try {
    const stripe = getStripe();
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: reason ?? "requested_by_customer",
      ...(amount !== undefined ? { amount: Math.round(amount * 100) } : {}),
    });

    logger.info(`Stripe refund created: ${refund.id} for PaymentIntent ${paymentIntentId}`);
    return { id: refund.id };
  } catch (error) {
    const err = error as { code?: string; type?: string };
    if (err.code === "charge_already_refunded") {
      logger.info(`PaymentIntent ${paymentIntentId} already refunded, skipping`);
      return null;
    }
    logger.error("Stripe refund failed", { paymentIntentId, error });
    throw error;
  }
}
