import { MongoClient } from "mongodb";
import { enqueueNotification } from "@/lib/automation/notifications";

export const LOW_STOCK_THRESHOLD = 20;
const STAFF_ROLES = ["admin", "gerente", "vendedor", "tecnico", "cajero"];
const globalForRules = globalThis as typeof globalThis & { __stocklyAutomationRulesClient?: MongoClient };

async function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = globalForRules.__stocklyAutomationRulesClient ??= new MongoClient(process.env.DATABASE_URL);
  await client.connect();
  const dbName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "").split("?")[0];
  if (!dbName) throw new Error("DATABASE_URL must include a database name");
  return client.db(dbName);
}

function id(value: unknown) { return String(value ?? ""); }
function num(value: unknown) { return typeof value === "number" ? value : Number(value ?? 0); }
function dayKey(date: Date) { return date.toISOString().slice(0, 10); }

async function recipients(database: Awaited<ReturnType<typeof db>>) {
  const users = await database.collection("User").find({ role: { $in: STAFF_ROLES } }, { projection: { _id: 1 } }).toArray();
  return users.map((user) => id(user._id)).filter(Boolean);
}

async function notifyMany(userIds: string[], input: Omit<Parameters<typeof enqueueNotification>[0], "userId" | "idempotencyKey">, key: string) {
  let count = 0;
  for (const userId of userIds) {
    await enqueueNotification({ ...input, userId, idempotencyKey: `${key}:${userId}` });
    count++;
  }
  return count;
}

export async function runAutomationRules(now = new Date()) {
  const database = await db();
  const today = dayKey(now);
  const staff = await recipients(database);
  const counts = { lowStock: 0, overdueAccounts: 0, warranties: 0, readyEquipment: 0, repairs: 0, paymentReminders: 0 };

  const products = await database.collection("Product").find({ deletedAt: null, quantity: { $lte: LOW_STOCK_THRESHOLD } }, { projection: { _id: 1, name: 1, sku: 1, quantity: 1 } }).limit(500).toArray();
  for (const product of products) {
    const quantity = num(product.quantity);
    const type = quantity <= 0 ? "stock_out" : "stock_low";
    counts.lowStock += await notifyMany(staff, {
      type,
      title: `${quantity <= 0 ? "Sin stock" : "Stock bajo"}: ${String(product.name ?? "Producto")}`,
      message: quantity <= 0 ? `El producto ${String(product.sku ?? product.name)} está agotado.` : `Quedan ${quantity} unidades de ${String(product.sku ?? product.name)}.`,
      priority: quantity <= 0 ? "critical" : "high",
      channels: ["in_app"],
      data: { productId: id(product._id), quantity },
    }, `automation:${type}:${id(product._id)}:${today}`);
  }

  const overdue = await database.collection("Invoice").find({ amountDue: { $gt: 0 }, dueDate: { $lt: now }, status: { $nin: ["paid", "cancelled"] } }, { projection: { _id: 1, invoiceNumber: 1, amountDue: 1, userId: 1 } }).limit(500).toArray();
  for (const invoice of overdue) {
    const targets = invoice.userId ? [id(invoice.userId)] : staff;
    counts.overdueAccounts += await notifyMany(targets, {
      type: "account_overdue", title: `Cuenta vencida: ${String(invoice.invoiceNumber ?? invoice._id)}`,
      message: `La factura ${String(invoice.invoiceNumber ?? invoice._id)} tiene un saldo vencido de $${num(invoice.amountDue).toLocaleString("es-CO")}.`,
      priority: "high", channels: ["in_app"], data: { invoiceId: id(invoice._id), amountDue: num(invoice.amountDue) },
    }, `automation:overdue:${id(invoice._id)}:${today}`);
  }

  const warrantyLimit = new Date(now.getTime() + 7 * 86400000);
  const warranties = await database.collection("ServiceOrder").find({ warrantyExpiresAt: { $gte: now, $lte: warrantyLimit } }, { projection: { _id: 1, orderNumber: 1, warrantyExpiresAt: 1, userId: 1 } }).limit(500).toArray();
  for (const order of warranties) {
    const targets = order.userId ? [id(order.userId)] : staff;
    counts.warranties += await notifyMany(targets, {
      type: "warranty_expiring", title: `Garantía por vencer: ${String(order.orderNumber ?? order._id)}`,
      message: `La garantía de la orden ${String(order.orderNumber ?? order._id)} vence el ${new Date(order.warrantyExpiresAt).toLocaleDateString("es-CO")}.`,
      priority: "normal", channels: ["in_app"], data: { serviceOrderId: id(order._id) },
    }, `automation:warranty:${id(order._id)}:${today}`);
  }

  const ready = await database.collection("ServiceOrder").find({ status: "ready" }, { projection: { _id: 1, orderNumber: 1, userId: 1, clientId: 1 } }).limit(500).toArray();
  for (const order of ready) {
    const targets = order.userId ? [id(order.userId)] : staff;
    counts.readyEquipment += await notifyMany(targets, {
      type: "equipment_ready", title: `Equipo listo: ${String(order.orderNumber ?? order._id)}`,
      message: `La orden de servicio ${String(order.orderNumber ?? order._id)} está lista para entrega.`, priority: "high", channels: ["in_app"],
      data: { serviceOrderId: id(order._id), clientId: id(order.clientId) },
    }, `automation:ready:${id(order._id)}:${today}`);
  }

  const repairing = await database.collection("ServiceOrder").find({ status: "repairing", updatedAt: { $lt: new Date(now.getTime() - 2 * 86400000) } }, { projection: { _id: 1, orderNumber: 1, userId: 1 } }).limit(500).toArray();
  for (const order of repairing) {
    const targets = order.userId ? [id(order.userId)] : staff;
    counts.repairs += await notifyMany(targets, {
      type: "repair_delayed", title: `Reparación pendiente: ${String(order.orderNumber ?? order._id)}`,
      message: `La orden ${String(order.orderNumber ?? order._id)} lleva más de 48 horas en reparación.`, priority: "normal", channels: ["in_app"], data: { serviceOrderId: id(order._id) },
    }, `automation:repair:${id(order._id)}:${today}`);
  }

  const due = await database.collection("ServiceOrder").find({ amountDue: { $gt: 0 }, status: { $nin: ["cancelled", "delivered"] } }, { projection: { _id: 1, orderNumber: 1, amountDue: 1, userId: 1 } }).limit(500).toArray();
  for (const order of due) {
    const targets = order.userId ? [id(order.userId)] : staff;
    counts.paymentReminders += await notifyMany(targets, {
      type: "payment_reminder", title: `Pago pendiente: ${String(order.orderNumber ?? order._id)}`,
      message: `La orden ${String(order.orderNumber ?? order._id)} tiene un saldo pendiente de $${num(order.amountDue).toLocaleString("es-CO")}.`, priority: "normal", channels: ["in_app"],
      data: { serviceOrderId: id(order._id), amountDue: num(order.amountDue) },
    }, `automation:payment:${id(order._id)}:${today}`);
  }
  return counts;
}
