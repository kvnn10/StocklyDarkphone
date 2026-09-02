import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { financeDb, jsonSafe, oid, validObjectId } from "@/lib/finance/financial-ledger";

const ROLES = ["admin", "user", "retailer"];

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const purchaseOrderId = request.nextUrl.searchParams.get("purchaseOrderId");
  if (!validObjectId(purchaseOrderId)) return NextResponse.json({ error: "Orden de compra inválida" }, { status: 400 });

  const purchase = await prisma.purchaseOrder.findFirst({ where: { id: purchaseOrderId, userId: session.id }, include: { items: true } });
  if (!purchase) return NextResponse.json({ error: "Orden de compra no encontrada" }, { status: 404 });

  const db = await financeDb();
  const payable = await db.collection("SupplierAccountPayable").findOne({ userId: oid(session.id), purchaseOrderId: oid(purchase.id) });
  const payments = payable ? await db.collection("SupplierPayment").find({ userId: oid(session.id), payableId: payable._id }).sort({ createdAt: 1 }).toArray() : [];
  const cashIds = payments.map((payment) => payment.cashMovementId).filter((id) => id && validObjectId(id.toHexString?.() ?? String(id))).map((id) => id.toHexString?.() ?? String(id));
  const cash = cashIds.length ? await prisma.cashMovement.findMany({ where: { userId: session.id, id: { in: cashIds } }, orderBy: { createdAt: "asc" } }) : [];
  const inventory = await prisma.inventoryMovement.findMany({ where: { userId: session.id, referenceId: purchase.id, type: "entry" }, orderBy: { createdAt: "asc" } });

  const receivedSubtotal = purchase.items.reduce((sum, item) => sum + item.receivedQuantity * item.unitCost, 0);
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  const expectedDue = Math.max(0, Number(payable?.originalAmount ?? 0) - paid);
  const cashTotal = cash.filter((movement) => movement.status !== "voided").reduce((sum, movement) => sum + Number(movement.amount ?? 0), 0);
  const inventoryUnits = inventory.reduce((sum, movement) => sum + Number(movement.quantity), 0);

  return NextResponse.json(jsonSafe({
    purchase,
    payable,
    payments,
    cash,
    inventory,
    reconciliation: {
      purchaseTotal: purchase.total,
      receivedSubtotal,
      payableAmount: Number(payable?.originalAmount ?? 0),
      paid,
      expectedDue,
      cashTotal,
      inventoryUnits,
      cashMatchesPayments: Math.abs(cashTotal - paid) <= 0.01,
      payableMatchesPayments: Math.abs(expectedDue - Number(payable?.amountDue ?? 0)) <= 0.01,
    },
  }));
}
