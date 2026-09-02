import { describe, expect, it } from "vitest";

export function remainingBalance(total: number, paid: number) {
  return Math.max(0, Number(total) - Number(paid));
}

export function cashDifference(expected: number, counted: number) {
  return Number(counted) - Number(expected);
}

export function canReturn(sold: number, alreadyReturned: number, requested: number) {
  return Number.isInteger(requested) && requested > 0 && alreadyReturned + requested <= sold;
}

describe("financial invariants", () => {
  it("never produces a negative receivable", () => expect(remainingBalance(100, 140)).toBe(0));
  it("calculates cash overage/shortage", () => {
    expect(cashDifference(100, 110)).toBe(10);
    expect(cashDifference(100, 90)).toBe(-10);
  });
  it("blocks returns beyond sold quantity", () => {
    expect(canReturn(3, 1, 2)).toBe(true);
    expect(canReturn(3, 2, 2)).toBe(false);
  });
});
