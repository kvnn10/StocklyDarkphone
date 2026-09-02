import { describe, expect, it } from "vitest";

function calculateAdjustment(current: bigint, counted: bigint, reserved: bigint) {
  if (counted < reserved) throw new Error("counted below reserved");
  return counted - current;
}

describe("physical inventory count invariants", () => {
  it("calculates a positive adjustment", () => {
    expect(calculateAdjustment(10n, 13n, 2n)).toBe(3n);
  });

  it("calculates a negative adjustment", () => {
    expect(calculateAdjustment(13n, 10n, 2n)).toBe(-3n);
  });

  it("never allows the count below reserved stock", () => {
    expect(() => calculateAdjustment(10n, 1n, 2n)).toThrow("counted below reserved");
  });
});
