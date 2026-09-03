import { describe, expect, it } from "vitest";
import { hasPermission, normalizeRole, permissionsForRole } from "./rbac";

describe("RBAC policy", () => {
  it("normalizes supported role names", () => {
    expect(normalizeRole("Administrator")).toBe("admin");
    expect(normalizeRole("técnico")).toBe("tecnico");
    expect(normalizeRole("unknown")).toBeNull();
  });

  it("gives admin full access", () => {
    expect(hasPermission("admin", "sales", "refund")).toBe(true);
    expect(hasPermission("admin", "finance", "close_cash")).toBe(true);
    expect(hasPermission("admin", "audit", "read")).toBe(true);
  });

  it("keeps sensitive actions out of operational roles", () => {
    expect(hasPermission("vendedor", "sales", "refund")).toBe(false);
    expect(hasPermission("tecnico", "finance", "close_cash")).toBe(false);
    expect(hasPermission("cajero", "products", "adjust_stock")).toBe(false);
  });

  it("exposes only the role's allowed permissions", () => {
    const permissions = permissionsForRole("tecnico");
    expect(permissions.service_orders).toContain("consume_part");
    expect(permissions.finance).toBeUndefined();
  });
});
