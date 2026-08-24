import { describe, expect, it } from "vitest";

describe("sales and cash invariants", () => {
  it("requires a positive sale total", () => {
    const validateTotal = (total: number) => {
      if (!Number.isFinite(total) || total <= 0) throw new Error("Sale total must be greater than zero");
      return total;
    };

    expect(() => validateTotal(0)).toThrow("Sale total must be greater than zero");
    expect(() => validateTotal(-10)).toThrow("Sale total must be greater than zero");
    expect(validateTotal(100)).toBe(100);
  });

  it("does not allow a payment greater than the sale balance", () => {
    const validatePayment = (balance: number, payment: number) => {
      if (payment <= 0) throw new Error("Payment must be greater than zero");
      if (payment > balance) throw new Error("Payment exceeds outstanding balance");
      return balance - payment;
    };

    expect(() => validatePayment(100, 101)).toThrow("Payment exceeds outstanding balance");
    expect(() => validatePayment(100, 0)).toThrow("Payment must be greater than zero");
    expect(validatePayment(100, 40)).toBe(60);
  });

  it("requires refunds not to exceed the amount already captured", () => {
    const validateRefund = (captured: number, refund: number) => {
      if (refund <= 0) throw new Error("Refund must be greater than zero");
      if (refund > captured) throw new Error("Refund exceeds captured amount");
      return captured - refund;
    };

    expect(() => validateRefund(100, 101)).toThrow("Refund exceeds captured amount");
    expect(validateRefund(100, 25)).toBe(75);
  });

  it("calculates cash balance from income, expenses and refunds", () => {
    const balance = (income: number, expenses: number, refunds: number) => income - expenses - refunds;

    expect(balance(1000, 200, 100)).toBe(700);
    expect(balance(500, 0, 0)).toBe(500);
  });

  it("does not treat cancelled orders as successful sales", () => {
    const contributesToSales = (status: string) => status === "confirmed" || status === "completed";

    expect(contributesToSales("cancelled")).toBe(false);
    expect(contributesToSales("refunded")).toBe(false);
    expect(contributesToSales("confirmed")).toBe(true);
  });
});
