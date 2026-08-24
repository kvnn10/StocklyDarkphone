import { describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/prisma/client", () => ({
  prisma: { auditLog: { create } },
}));

describe("audit logging contract", () => {
  it("writes the required audit fields", async () => {
    create.mockResolvedValueOnce({ id: "audit-1" });
    const { writeAuditLog } = await import("./log");

    await writeAuditLog({
      userId: "user-1",
      action: "STOCK_TRANSFER_COMPLETED",
      entityType: "StockTransfer",
      entityId: "transfer-1",
      details: { quantity: 3 },
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        action: "STOCK_TRANSFER_COMPLETED",
        entityType: "StockTransfer",
        entityId: "transfer-1",
        details: { quantity: 3 },
        ipAddress: "127.0.0.1",
        userAgent: "vitest",
      },
    });
  });

  it("does not break the business operation when audit persistence fails", async () => {
    create.mockRejectedValueOnce(new Error("database unavailable"));
    const { writeAuditLog } = await import("./log");

    await expect(
      writeAuditLog({
        userId: "user-1",
        action: "CASH_MOVEMENT_CREATED",
        entityType: "CashMovement",
        entityId: "cash-1",
      }),
    ).resolves.toBeNull();
  });
});
