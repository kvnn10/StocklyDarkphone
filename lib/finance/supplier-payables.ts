import { financeDb, oid } from "@/lib/finance/financial-ledger";

export type PurchasePayableInput = {
  userId: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId: string;
  purchaseNumber: string;
  subtotal: number;
  tax: number;
  shipping: number;
  receivedItems: Array<{ receivedQuantity: number; unitCost: number }>;
  dueDate?: Date;
  now?: Date;
};

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateReceivedPayableAmount(input: Pick<PurchasePayableInput, "subtotal" | "tax" | "shipping" | "receivedItems">) {
  const receivedSubtotal = roundMoney(input.receivedItems.reduce((sum, item) => sum + Math.max(0, item.receivedQuantity) * Math.max(0, item.unitCost), 0));
  if (receivedSubtotal <= 0) return { receivedSubtotal: 0, accruedAmount: 0 };
  const baseSubtotal = Math.max(0, input.subtotal);
  const extras = Math.max(0, input.tax) + Math.max(0, input.shipping);
  const allocatedExtras = baseSubtotal > 0 ? roundMoney(extras * Math.min(1, receivedSubtotal / baseSubtotal)) : 0;
  return { receivedSubtotal, accruedAmount: roundMoney(receivedSubtotal + allocatedExtras) };
}

export async function upsertPurchasePayable(input: PurchasePayableInput) {
  const db = await financeDb();
  await ensureSupplierPayableIndexes();
  const now = input.now ?? new Date();
  const { receivedSubtotal, accruedAmount } = calculateReceivedPayableAmount(input);
  if (accruedAmount <= 0) throw new Error("La recepción no genera una cuenta por pagar válida");

  const collection = db.collection("SupplierAccountPayable");
  const existing = await collection.findOne({ userId: oid(input.userId), purchaseOrderId: oid(input.purchaseOrderId) });
  if (existing) {
    const amountPaid = Number(existing.amountPaid ?? 0);
    if (amountPaid > accruedAmount + 0.0001) throw new Error("La deuda del proveedor es menor que los pagos registrados");
    const amountDue = roundMoney(Math.max(0, accruedAmount - amountPaid));
    await collection.updateOne(
      { _id: existing._id, userId: oid(input.userId) },
      { $set: { supplierId: oid(input.supplierId), supplierName: input.supplierName, reference: input.purchaseNumber, originalAmount: accruedAmount, amountDue, status: amountDue <= 0.0001 ? "paid" : amountPaid > 0 ? "partial" : "open", receivedSubtotal, updatedAt: now } },
    );
    return { id: existing._id.toHexString(), created: false, originalAmount: accruedAmount, amountPaid, amountDue };
  }

  const document = {
    userId: oid(input.userId),
    supplierId: oid(input.supplierId),
    supplierName: input.supplierName,
    reference: input.purchaseNumber,
    purchaseOrderId: oid(input.purchaseOrderId),
    originalAmount: accruedAmount,
    amountPaid: 0,
    amountDue: accruedAmount,
    receivedSubtotal,
    status: "open",
    dueDate: input.dueDate ?? now,
    notes: "Generada automáticamente por recepción de compra",
    createdAt: now,
    updatedAt: now,
    createdBy: oid(input.userId),
  };
  const result = await collection.insertOne(document);
  return { id: result.insertedId.toHexString(), created: true, originalAmount: accruedAmount, amountPaid: 0, amountDue: accruedAmount };
}

export async function getSupplierStatement(userId: string, supplierId: string) {
  const db = await financeDb();
  const filter = { userId: oid(userId), supplierId: oid(supplierId) };
  const payables = await db.collection("SupplierAccountPayable").find(filter).sort({ createdAt: -1 }).limit(500).toArray();
  const payments = await db.collection("SupplierPayment").find({ ...filter }).sort({ createdAt: -1 }).limit(1000).toArray();
  const totalInvoiced = roundMoney(payables.reduce((sum, row) => sum + Number(row.originalAmount ?? 0), 0));
  const totalPaid = roundMoney(payments.reduce((sum, row) => sum + Number(row.amount ?? 0), 0));
  const outstanding = roundMoney(Math.max(0, totalInvoiced - totalPaid));
  return { totalInvoiced, totalPaid, outstanding, payables, payments };
}

export async function ensureSupplierPayableIndexes() {
  const db = await financeDb();
  await db.collection("SupplierAccountPayable").createIndex({ userId: 1, purchaseOrderId: 1 }, { unique: true, partialFilterExpression: { purchaseOrderId: { $exists: true } } });
  await db.collection("SupplierPayment").createIndex({ payableId: 1, createdAt: -1 });
}
