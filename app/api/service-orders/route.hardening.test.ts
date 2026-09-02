/**
 * Regression contract for the critical service-order money/inventory flow.
 * Static by design: it runs without a database and protects the concurrency/idempotency
 * invariants that must remain present in the production route.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ROUTE = readFileSync(join(ROOT, "app/api/service-orders/route.ts"), "utf8");

describe("service orders hardening regression contract", () => {
  it("uses deterministic payment IDs for idempotent retries", () => {
    expect(ROUTE).toContain("paymentIdForKey");
    expect(ROUTE).toContain("deterministicPaymentId");
    expect(ROUTE).toContain("serviceOrderPayment.findUnique");
    expect(ROUTE).toContain("P2002");
  });

  it("updates the service-order balance conditionally inside the transaction", () => {
    expect(ROUTE).toContain("prisma.$transaction");
    expect(ROUTE).toContain("amountDue: { gte: amount }");
    expect(ROUTE).toContain("El saldo cambió mientras se registraba el pago. Intenta nuevamente");
  });

  it("creates payment and cash movement atomically", () => {
    expect(ROUTE).toContain("tx.serviceOrderPayment.create");
    expect(ROUTE).toContain("tx.cashMovement.create");
    expect(ROUTE).toContain("deterministicPaymentId ? { id: deterministicPaymentId } : {}");
  });

  it("claims a service-order part atomically before creating its inventory movement", () => {
    expect(ROUTE).toContain("inventoryApplied: false");
    expect(ROUTE).toContain("serviceOrderItem.updateMany");
    expect(ROUTE).toContain("updatedItem.count !== 1");
    expect(ROUTE).toContain("tx.inventoryMovement.create");
  });
});
