import { describe, expect, it } from "vitest";

/**
 * Regression tests for the order/stock lifecycle contract.
 * These tests intentionally validate the state-transition rules without
 * requiring a live MongoDB connection.
 */

type StockState = {
  quantity: number;
  reserved: number;
  committed: number;
};

const available = (s: StockState) => Math.max(0, s.quantity - s.reserved - s.committed);

function reservePending(s: StockState, qty: number): StockState {
  if (available(s) < qty) throw new Error("Insufficient stock");
  return { ...s, reserved: s.reserved + qty };
}

function fulfillPending(s: StockState, qty: number): StockState {
  if (s.reserved < qty) throw new Error("Reservation not found");
  return { quantity: s.quantity - qty, reserved: s.reserved - qty, committed: s.committed + qty };
}

function releasePending(s: StockState, qty: number): StockState {
  if (s.reserved < qty) throw new Error("Reservation not found");
  return { ...s, reserved: s.reserved - qty };
}

function restoreConfirmed(s: StockState, qty: number): StockState {
  if (s.committed < qty) throw new Error("Committed stock not found");
  return { quantity: s.quantity + qty, reserved: s.reserved, committed: s.committed - qty };
}

describe("order stock lifecycle", () => {
  it("pending -> confirmed consumes reserved stock exactly once", () => {
    const pending = reservePending({ quantity: 10, reserved: 0, committed: 0 }, 3);
    const confirmed = fulfillPending(pending, 3);

    expect(pending).toEqual({ quantity: 10, reserved: 3, committed: 0 });
    expect(confirmed).toEqual({ quantity: 7, reserved: 0, committed: 3 });
    expect(available(confirmed)).toBe(4);
  });

  it("pending -> cancelled releases the reservation without changing physical stock", () => {
    const pending = reservePending({ quantity: 10, reserved: 0, committed: 0 }, 3);
    const cancelled = releasePending(pending, 3);

    expect(cancelled).toEqual({ quantity: 10, reserved: 0, committed: 0 });
  });

  it("confirmed -> cancelled restores committed stock exactly once", () => {
    const confirmed = { quantity: 7, reserved: 0, committed: 3 };
    const cancelled = restoreConfirmed(confirmed, 3);

    expect(cancelled).toEqual({ quantity: 10, reserved: 0, committed: 0 });
  });

  it("cannot reserve more than currently available", () => {
    expect(() => reservePending({ quantity: 5, reserved: 2, committed: 0 }, 4)).toThrow(
      "Insufficient stock",
    );
  });

  it("cannot fulfill the same reservation twice", () => {
    const pending = reservePending({ quantity: 10, reserved: 0, committed: 0 }, 3);
    const confirmed = fulfillPending(pending, 3);

    expect(() => fulfillPending(confirmed, 3)).toThrow("Reservation not found");
  });
});
