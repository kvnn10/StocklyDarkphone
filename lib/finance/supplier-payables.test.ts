import { describe, expect, it } from "vitest";
import { calculateReceivedPayableAmount, roundMoney } from "./supplier-payables";

describe("supplier payables", () => {
  it("allocates tax and shipping proportionally on a partial receipt", () => {
    const result = calculateReceivedPayableAmount({
      subtotal: 1000,
      tax: 190,
      shipping: 50,
      receivedItems: [{ receivedQuantity: 5, unitCost: 100 }],
    });
    expect(result.receivedSubtotal).toBe(500);
    expect(result.accruedAmount).toBe(620);
  });

  it("reaches the purchase total after full receipt", () => {
    const result = calculateReceivedPayableAmount({
      subtotal: 1000,
      tax: 190,
      shipping: 50,
      receivedItems: [{ receivedQuantity: 10, unitCost: 100 }],
    });
    expect(result.accruedAmount).toBe(1240);
  });

  it("rounds money consistently", () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(10.004)).toBe(10);
  });
});
