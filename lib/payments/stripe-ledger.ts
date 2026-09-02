import type { Prisma } from "@prisma/client";

export type StripeLedgerEntry = {
  id: string;
  kind: "payment_intent" | "refund";
  paymentIntentId: string;
  refundId?: string;
  orderId?: string | null;
  invoiceId?: string | null;
  amount: number;
  currency: string;
  status: "applied";
  createdAt: Date;
};

/** Durable Stripe idempotency ledger backed by a MongoDB collection. */
export async function recordStripeLedgerEntry(
  tx: Prisma.TransactionClient,
  entry: StripeLedgerEntry,
): Promise<void> {
  await tx.$runCommandRaw({
    insert: "StripeLedger",
    documents: [{
      _id: entry.id,
      kind: entry.kind,
      paymentIntentId: entry.paymentIntentId,
      refundId: entry.refundId ?? null,
      orderId: entry.orderId ?? null,
      invoiceId: entry.invoiceId ?? null,
      amount: entry.amount,
      currency: entry.currency,
      status: entry.status,
      createdAt: entry.createdAt,
    }],
  });
}

export function isDuplicateStripeLedgerError(error: unknown): boolean {
  return (error as { code?: number })?.code === 11000;
}
