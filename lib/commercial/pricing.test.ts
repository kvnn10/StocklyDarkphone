import { describe, expect, it } from "vitest";
import { applyPromotion, calculateManualDiscount, calculatePromotionSubtotal, choosePromotion } from "@/lib/commercial/pricing";

describe("Phase 2 commercial pricing", () => {
  it("applies 2x1 without changing the unit catalog price", () => {
    const result = applyPromotion(100, 5, {
      id: "p", name: "2x1", type: "2x1", value: 0,
      startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2027-01-01T00:00:00.000Z",
      active: true, priority: 1, stackable: false,
    });
    expect(result.unitPrice).toBe(100);
    expect(result.discount).toBe(200);
  });

  it("uses the promotion discount when calculating the real 2x1 subtotal", () => {
    expect(calculatePromotionSubtotal(100, 5, {
      id: "p", name: "2x1", type: "2x1", value: 0,
      startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2027-01-01T00:00:00.000Z",
      active: true, priority: 1, stackable: false,
    })).toBe(300);
  });

  it("applies 3x2 correctly to the line subtotal", () => {
    expect(calculatePromotionSubtotal(90, 6, {
      id: "p", name: "3x2", type: "3x2", value: 0,
      startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2027-01-01T00:00:00.000Z",
      active: true, priority: 1, stackable: false,
    })).toBe(360);
  });

  it("never discounts more than the line value", () => {
    expect(calculateManualDiscount(100, "fixed", 150)).toBe(100);
    expect(calculateManualDiscount(100, "percent", 25)).toBe(25);
  });

  it("chooses the highest-priority active promotion", () => {
    const base = { productId: "x", startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2027-01-01T00:00:00.000Z", active: true, stackable: false };
    const selected = choosePromotion([
      { ...base, id: "low", name: "low", type: "price", value: 80, priority: 1 },
      { ...base, id: "high", name: "high", type: "price", value: 70, priority: 10 },
    ], "x", new Date("2026-06-01T00:00:00.000Z"));
    expect(selected?.id).toBe("high");
  });
});
