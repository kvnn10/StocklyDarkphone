import { describe, expect, it } from "vitest";
import { LOW_STOCK_THRESHOLD } from "./rules";

describe("automation rules", () => {
  it("uses the existing low-stock threshold", () => {
    expect(LOW_STOCK_THRESHOLD).toBe(20);
  });
});
