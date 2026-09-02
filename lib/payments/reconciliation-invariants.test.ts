import { describe, expect, it } from "vitest";
import { deriveOrderPaymentStatus, resolveInvoiceStatusAfterMoney } from "./order-payment-from-amounts";

describe("payment reconciliation invariants", () => {
  it("keeps paid order and invoice settled only when money reaches the total", () => {
    expect(deriveOrderPaymentStatus(1880.06, 1880.06)).toBe("paid");
    expect(deriveOrderPaymentStatus(1880.05, 1880.06)).toBe("partial");
    expect(resolveInvoiceStatusAfterMoney({ status: "sent", amountPaid: 1880.06, total: 1880.06 })).toBe("paid");
  });

  it("does not consider a partial payment fully settled", () => {
    expect(deriveOrderPaymentStatus(900, 1880.06)).toBe("partial");
    expect(resolveInvoiceStatusAfterMoney({ status: "sent", amountPaid: 900, total: 1880.06 })).toBe("sent");
  });
});
