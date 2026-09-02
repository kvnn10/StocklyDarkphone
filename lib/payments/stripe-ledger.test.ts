import { describe, expect, it, vi } from "vitest";
import {
  isDuplicateStripeLedgerError,
  recordStripeLedgerEntry,
} from "./stripe-ledger";

describe("Stripe ledger", () => {
  it("persists a payment intent identity with its business references", async () => {
    const runCommandRaw = vi.fn().mockResolvedValue({ ok: 1 });
    const tx = { $runCommandRaw: runCommandRaw } as never;
    const createdAt = new Date("2026-09-02T05:00:00.000Z");

    await recordStripeLedgerEntry(tx, {
      id: "payment_intent:pi_regression_001",
      kind: "payment_intent",
      paymentIntentId: "pi_regression_001",
      orderId: "order_001",
      invoiceId: "invoice_001",
      amount: 125,
      currency: "usd",
      status: "applied",
      createdAt,
    });

    expect(runCommandRaw).toHaveBeenCalledTimes(1);
    expect(runCommandRaw).toHaveBeenCalledWith({
      insert: "StripeLedger",
      documents: [
        {
          _id: "payment_intent:pi_regression_001",
          kind: "payment_intent",
          paymentIntentId: "pi_regression_001",
          refundId: null,
          orderId: "order_001",
          invoiceId: "invoice_001",
          amount: 125,
          currency: "usd",
          status: "applied",
          createdAt,
        },
      ],
    });
  });

  it("uses a different durable identity for a refund than its PaymentIntent", async () => {
    const runCommandRaw = vi.fn().mockResolvedValue({ ok: 1 });
    const tx = { $runCommandRaw: runCommandRaw } as never;

    await recordStripeLedgerEntry(tx, {
      id: "refund:re_regression_001",
      kind: "refund",
      paymentIntentId: "pi_regression_001",
      refundId: "re_regression_001",
      orderId: "order_001",
      invoiceId: "invoice_001",
      amount: 50,
      currency: "usd",
      status: "applied",
      createdAt: new Date("2026-09-02T05:01:00.000Z"),
    });

    expect(runCommandRaw.mock.calls[0]?.[0]).toMatchObject({
      insert: "StripeLedger",
      documents: [
        expect.objectContaining({
          _id: "refund:re_regression_001",
          kind: "refund",
          paymentIntentId: "pi_regression_001",
          refundId: "re_regression_001",
          amount: 50,
        }),
      ],
    });
    expect(
      runCommandRaw.mock.calls[0]?.[0].documents[0]._id,
    ).not.toBe("payment_intent:pi_regression_001");
  });

  it("recognizes Mongo duplicate-key errors as concurrent idempotency", () => {
    expect(isDuplicateStripeLedgerError({ code: 11000 })).toBe(true);
    expect(isDuplicateStripeLedgerError({ code: 11001 })).toBe(false);
    expect(isDuplicateStripeLedgerError(new Error("duplicate"))).toBe(false);
  });
});
