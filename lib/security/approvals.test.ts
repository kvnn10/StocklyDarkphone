import { describe, expect, it } from "vitest";
import { hasPermission, normalizeRole } from "@/lib/security/rbac";

export function calculatePaymentChange(total: number, cashReceived: number) {
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(cashReceived) || cashReceived < total) return null;
  return cashReceived - total;
}

describe("security approvals", () => {
  it("normalizes legacy roles without weakening privileged access", () => {
    expect(normalizeRole("retailer")).toBe("vendedor");
    expect(normalizeRole("user")).toBe("vendedor");
    expect(normalizeRole("Administrator")).toBe("admin");
  });

  it("lets operational roles request approvals but only admin/manager decide", () => {
    expect(hasPermission("vendedor", "approvals", "create")).toBe(true);
    expect(hasPermission("tecnico", "approvals", "create")).toBe(true);
    expect(hasPermission("cajero", "approvals", "create")).toBe(true);
    expect(hasPermission("vendedor", "approvals", "approve")).toBe(false);
    expect(hasPermission("cajero", "approvals", "reject")).toBe(false);
    expect(hasPermission("gerente", "approvals", "approve")).toBe(true);
    expect(hasPermission("gerente", "approvals", "reject")).toBe(true);
    expect(hasPermission("admin", "approvals", "approve")).toBe(true);
  });

  it("keeps sensitive actions restricted by role", () => {
    expect(hasPermission("vendedor", "sales", "discount")).toBe(false);
    expect(hasPermission("vendedor", "sales", "refund")).toBe(false);
    expect(hasPermission("tecnico", "products", "adjust_stock")).toBe(false);
    expect(hasPermission("gerente", "sales", "discount")).toBe(true);
    expect(hasPermission("admin", "sales", "refund")).toBe(true);
  });

  it("allows authorized cashier/seller payment flows through finance", () => {
    expect(hasPermission("cajero", "finance", "create_payment")).toBe(true);
    expect(hasPermission("vendedor", "finance", "create_payment")).toBe(true);
    expect(hasPermission("tecnico", "finance", "create_payment")).toBe(false);
  });

  it("calculates cash change and rejects insufficient cash", () => {
    expect(calculatePaymentChange(100000, 120000)).toBe(20000);
    expect(calculatePaymentChange(100000, 100000)).toBe(0);
    expect(calculatePaymentChange(100000, 99999)).toBeNull();
  });
});
