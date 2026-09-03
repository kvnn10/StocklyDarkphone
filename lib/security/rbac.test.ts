import { describe, expect, it } from "vitest";
import { hasPermission, normalizeRole, permissionsForRole } from "./rbac";

describe("RBAC policy", () => {
  it("normalizes supported role names and legacy aliases", () => {
    expect(normalizeRole("Administrator")).toBe("admin");
    expect(normalizeRole("técnico")).toBe("tecnico");
    expect(normalizeRole("retailer")).toBe("vendedor");
    expect(normalizeRole("user")).toBe("vendedor");
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
    expect(hasPermission("vendedor", "finance", "manage_expenses")).toBe(false);
  });
  it("allows expense management only to authorized finance roles", () => {
    expect(hasPermission("admin", "finance", "manage_expenses")).toBe(true);
    expect(hasPermission("gerente", "finance", "manage_expenses")).toBe(true);
    expect(hasPermission("cajero", "finance", "manage_expenses")).toBe(false);
  });
  it("exposes only the role's allowed permissions", () => {
    const permissions = permissionsForRole("tecnico");
    expect(permissions.service_orders).toContain("consume_part");
    expect(permissions.finance).toBeUndefined();
  });
  it("keeps service-order payment vocabulary consistent", () => {
    expect(hasPermission("cajero", "service_orders", "create_payment")).toBe(true);
    expect(hasPermission("tecnico", "service_orders", "create_payment")).toBe(false);
    expect(hasPermission("gerente", "service_orders", "create_payment")).toBe(true);
  });
});
