import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { MongoClient, ObjectId } from "mongodb";
import { writeAuditLog } from "@/lib/audit/log";

const ROLES = ["admin", "user", "retailer"];
const METHODS = ["cash", "card", "transfer", "other"];
const validId = (v: unknown) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);

function safe(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toHexString();
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safe(v)]));
  return value;
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  try {
    const rows = await client.db().collection("SaleReturn").find({ userId: new ObjectId(session.id) }).sort({ createdAt: -1 }).limit(200).toArray();
    return NextResponse.json(rows.map(safe));
  } finally { await client.close(); }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  const mongoSession = client.startSession();
  try {
    const body = await request.json();
    if (!validId(body.orderId) || !Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: "Venta e ítems son obligatorios" }, { status: 400 });
    const paymentMethod = METHODS.includes(body.paymentMethod) ? body.paymentMethod : "cash";
    const result = await mongoSession.withTransaction(async () => {
      const db = client.db();
      const orders = db.collection("Order"); const orderItems = db.collection("OrderItem"); const returns = db.collection("SaleReturn");
      const products = db.collection("Product"); const allocations = db.collection("StockAllocation"); const cash = db.collection("CashMovement"); const invoices = db.collection("Invoice");
      const orderId = new ObjectId(body.orderId);
      const order = await orders.findOne({ _id: orderId, userId: new ObjectId(session.id) }, { session: mongoSession });
      if (!order) throw Object.assign(new Error("Venta no encontrada"), { status: 404 });
      if (["cancelled"].includes(order.status)) throw Object.assign(new Error("No se puede devolver una venta cancelada"), { status: 409 });
      let totalRefund = 0; const processed: any[] = [];
      for (const requested of body.items) {
        if (!validId(requested.orderItemId)) throw Object.assign(new Error("Ítem inválido"), { status: 400 });
        const qty = Number(requested.quantity);
        if (!Number.isInteger(qty) || qty <= 0) throw Object.assign(new Error("La cantidad devuelta debe ser un entero positivo"), { status: 400 });
        const item = await orderItems.findOne({ _id: new ObjectId(requested.orderItemId), orderId }, { session: mongoSession });
        if (!item) throw Object.assign(new Error("Ítem no encontrado en la venta"), { status: 404 });
        const previousReturned = await returns.aggregate([{ $match: { orderId, "items.orderItemId": item._id } }, { $unwind: "$items" }, { $match: { "items.orderItemId": item._id } }, { $group: { _id: null, qty: { $sum: "$items.quantity" } } }], { session: mongoSession }).next();
        const already = Number(previousReturned?.qty ?? 0);
        if (already + qty > Number(item.quantity)) throw Object.assign(new Error(`La devolución supera la cantidad vendida de ${item.productName}`), { status: 409 });
        const lineRefund = Number(item.price) * qty; totalRefund += lineRefund;
        const productId = new ObjectId(item.productId);
        const product = await products.findOne({ _id: productId }, { session: mongoSession });
        if (!product) throw Object.assign(new Error("Producto asociado no encontrado"), { status: 404 });
        if (item.warehouseId) {
          const warehouseId = new ObjectId(item.warehouseId);
          const allocation = await allocations.findOne({ productId, warehouseId }, { session: mongoSession });
          if (!allocation) throw Object.assign(new Error("Ubicación de inventario no encontrada"), { status: 409 });
          await allocations.updateOne({ _id: allocation._id }, { $inc: { quantity: qty }, $set: { updatedAt: new Date() } }, { session: mongoSession });
        }
        await products.updateOne({ _id: productId }, { $inc: { quantity: qty }, $set: { updatedAt: new Date() } }, { session: mongoSession });
        processed.push({ orderItemId: item._id, productId, productName: item.productName, quantity: qty, unitPrice: Number(item.price), subtotal: lineRefund, warehouseId: item.warehouseId ? new ObjectId(item.warehouseId) : null });
      }
      if (totalRefund <= 0) throw Object.assign(new Error("El reembolso debe ser mayor que cero"), { status: 409 });
      const now = new Date();
      const invoice = await invoices.findOne({ orderId }, { session: mongoSession });
      if (invoice) {
        const paid = Math.max(0, Number(invoice.amountPaid ?? 0) - totalRefund);
        const total = Number(invoice.total ?? order.total ?? 0);
        await invoices.updateOne({ _id: invoice._id }, { $set: { amountPaid: paid, amountDue: Math.max(0, total - paid), status: paid <= 0.0001 ? "refunded" : "partial_refund", updatedAt: now } }, { session: mongoSession });
      }
      const existingReturned = await returns.aggregate([{ $match: { orderId } }, { $group: { _id: null, amount: { $sum: "$amount" } } }], { session: mongoSession }).next();
      const cumulative = Number(existingReturned?.amount ?? 0) + totalRefund;
      await orders.updateOne({ _id: orderId }, { $set: { paymentStatus: cumulative >= Number(order.total ?? 0) - 0.0001 ? "refunded" : "partial_refund", updatedAt: now } }, { session: mongoSession });
      const cashDoc = { type: "expense", source: "refund", orderId, orderNumber: order.orderNumber, amount: totalRefund, paymentMethod, userId: new ObjectId(session.id), createdBy: new ObjectId(session.id), description: `Devolución parcial ${order.orderNumber}`, status: "active", createdAt: now };
      await cash.insertOne(cashDoc, { session: mongoSession });
      const document = { returnNumber: `RET-${Date.now()}-${Math.floor(Math.random() * 1000)}`, orderId, orderNumber: order.orderNumber, userId: new ObjectId(session.id), amount: totalRefund, paymentMethod, type: "partial", reason: typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : null, items: processed, createdAt: now, createdBy: new ObjectId(session.id) };
      const inserted = await returns.insertOne(document, { session: mongoSession });
      return { ...document, _id: inserted.insertedId };
    });
    if (!result) throw Object.assign(new Error("No se pudo confirmar la devolución"), { status: 500 });
    await writeAuditLog({ userId: session.id, action: "SALE_PARTIAL_RETURN", entityType: "SaleReturn", entityId: result._id.toHexString(), details: { orderId: result.orderId.toHexString(), amount: result.amount, itemCount: result.items.length, paymentMethod: result.paymentMethod } });
    return NextResponse.json(safe(result), { status: 201 });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as any).status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo procesar la devolución" }, { status });
  } finally { await mongoSession.endSession(); await client.close(); }
}
