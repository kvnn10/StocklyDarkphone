import { financeDb, jsonSafe, oid } from "@/lib/finance/financial-ledger";

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type SaleReceivableInput = {
  userId: string;
  orderId: string;
  orderNumber: string;
  clientId: string | null;
  total: number;
  amountPaid?: number;
  dueDate?: Date;
  now?: Date;
};

export async function ensureSaleReceivable(input: SaleReceivableInput) {
  const total = roundMoney(Math.max(0, Number(input.total) || 0));
  const amountPaid = roundMoney(Math.min(total, Math.max(0, Number(input.amountPaid ?? 0) || 0)));
  const amountDue = roundMoney(Math.max(0, total - amountPaid));
  if (!input.clientId || amountDue <= 0) return null;

  const db = await financeDb();
  await ensureSaleReceivableIndexes();
  const now = input.now ?? new Date();
  const collection = db.collection("AccountReceivable");
  const filter = { userId: oid(input.userId), orderId: oid(input.orderId) };
  const existing = await collection.findOne(filter);

  if (existing) {
    const existingPaid = roundMoney(Math.max(0, Number(existing.amountPaid ?? 0)));
    const nextPaid = roundMoney(Math.min(total, Math.max(existingPaid, amountPaid)));
    const nextDue = roundMoney(Math.max(0, total - nextPaid));
    await collection.updateOne(filter, {
      $set: {
        clientId: oid(input.clientId),
        orderNumber: input.orderNumber,
        originalAmount: total,
        amountPaid: nextPaid,
        amountDue: nextDue,
        status: nextDue <= 0.0001 ? "paid" : nextPaid > 0 ? "partial" : "open",
        dueDate: input.dueDate ?? existing.dueDate ?? now,
        updatedAt: now,
      },
    });
    return jsonSafe(await collection.findOne(filter));
  }

  const document = {
    userId: oid(input.userId),
    orderId: oid(input.orderId),
    orderNumber: input.orderNumber,
    clientId: oid(input.clientId),
    originalAmount: total,
    amountPaid,
    amountDue,
    status: amountDue <= 0.0001 ? "paid" : amountPaid > 0 ? "partial" : "open",
    dueDate: input.dueDate ?? now,
    createdAt: now,
    updatedAt: now,
    createdBy: oid(input.userId),
  };

  try {
    const result = await collection.insertOne(document);
    return jsonSafe({ ...document, _id: result.insertedId });
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    return jsonSafe(await collection.findOne(filter));
  }
}

export async function ensureSaleReceivableIndexes() {
  const db = await financeDb();
  await db.collection("AccountReceivable").createIndex({ userId: 1, orderId: 1 }, { unique: true });
  await db.collection("AccountReceivable").createIndex({ userId: 1, clientId: 1, dueDate: 1 });
  await db.collection("AccountReceivablePayment").createIndex({ receivableId: 1, createdAt: -1 });
}
