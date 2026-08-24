import { describe, expect, it } from "vitest";
import { calculateServiceOrderTotals, formatServiceOrderNumber } from "./service-order-number";

describe("service order domain helpers", () => {
  it("formats sequential service order numbers", () => {
    expect(formatServiceOrderNumber(1)).toBe("ST-000001");
    expect(formatServiceOrderNumber(42)).toBe("ST-000042");
  });

  it("rejects invalid sequences", () => {
    expect(() => formatServiceOrderNumber(0)).toThrow();
    expect(() => formatServiceOrderNumber(1.5)).toThrow();
  });

  it("calculates labor and parts totals", () => {
    expect(calculateServiceOrderTotals({ labor: 50000, parts: 125000 })).toEqual({
      subtotal: 175000,
      total: 175000,
    });
  });

  it("applies discount and tax safely", () => {
    expect(calculateServiceOrderTotals({ labor: 100000, parts: 50000, discount: 10000, tax: 5000 })).toEqual({
      subtotal: 150000,
      total: 145000,
    });
  });
});
