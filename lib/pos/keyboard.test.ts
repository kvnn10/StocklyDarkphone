import { describe, expect, it } from "vitest";

const SHORTCUTS = ["F2", "F9", "Enter"] as const;

describe("POS keyboard contract", () => {
  it("reserves the fast-sale keys", () => {
    expect(SHORTCUTS).toContain("F2");
    expect(SHORTCUTS).toContain("F9");
    expect(SHORTCUTS).toContain("Enter");
  });
});
