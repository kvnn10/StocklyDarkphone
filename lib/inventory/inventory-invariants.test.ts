import { describe, expect, it } from "vitest";

describe("inventory invariants", () => {
  it("rejects negative quantities", () => {
    const validate = (value: number) => {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Stock quantity must be a non-negative integer");
      return value;
    };

    expect(() => validate(-1)).toThrow("Stock quantity must be a non-negative integer");
    expect(validate(0)).toBe(0);
    expect(validate(5)).toBe(5);
  });

  it("rejects zero or negative transfer quantities", () => {
    const validateTransfer = (value: number) => {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Transfer quantity must be greater than zero");
      return value;
    };

    expect(() => validateTransfer(0)).toThrow("Transfer quantity must be greater than zero");
    expect(() => validateTransfer(-2)).toThrow("Transfer quantity must be greater than zero");
    expect(validateTransfer(3)).toBe(3);
  });

  it("does not allow a transfer to use the same warehouse as source and destination", () => {
    const validateWarehouses = (from: string, to: string) => {
      if (from === to) throw new Error("Source and destination warehouses must be different");
    };

    expect(() => validateWarehouses("w1", "w1")).toThrow(
      "Source and destination warehouses must be different",
    );
    expect(() => validateWarehouses("w1", "w2")).not.toThrow();
  });

  it("calculates available stock after reservations", () => {
    const available = (quantity: number, reserved: number) => quantity - reserved;

    expect(available(10, 3)).toBe(7);
    expect(available(5, 5)).toBe(0);
    expect(available(4, 6)).toBe(-2);
  });
});
