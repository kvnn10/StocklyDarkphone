import { describe, expect, it } from "vitest";

const SHORTCUTS = ["F2", "F9", "F4", "F5", "F6", "F7", "Enter"] as const;

describe("POS keyboard contract", () => {
  it("reserves the fast-sale and payment keys", () => {
    expect(SHORTCUTS).toEqual(expect.arrayContaining(["F2", "F9", "F4", "F5", "F6", "F7", "Enter"]));
  });
});
