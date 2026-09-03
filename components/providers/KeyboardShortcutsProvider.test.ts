import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "./KeyboardShortcutsProvider";

describe("POS keyboard shortcuts", () => {
  it("exposes the core POS shortcuts", () => {
    expect(SHORTCUTS).toEqual(expect.arrayContaining([
      { keys: "F2", description: "En POS: enfocar búsqueda de producto" },
      { keys: "F9", description: "En POS: continuar al pago" },
    ]));
  });
});
