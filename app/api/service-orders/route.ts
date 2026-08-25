import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId, Long } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/prisma/client";

const STATUSES = ["received", "diagnosis", "awaiting_approval", "repairing", "ready", "delivered", "cancelled"] as const;
type Status = (typeof STATUSES)[number];
function allowed(session: any) { return !!session && ["admin", "user", "retailer"].includes(session.role ?? ""); }
async function db() { const client = new MongoClient(process.env.DATABASE_URL!); await client.connect(); return client; }
const money = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; };
const terminal = (status: string) => status === "delivered" || status === "cancelled";

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const client = await db();
  try {
    const params = new URL(request.url).searchParams, search = params.get("search")?.trim() ?? "", status = params.get("status")?.trim() ?? "";
    const query: any = { userId: session.id };
    if (status && STATUSES.includes(status as Status)) query.status = status;
    if (search) query.$or = ["orderNumber", "customer", "phone", "device", "imei", "serial"].map(field => ({ [field]: { $regex: search, $options: "i" } }));
    const orders = await client.db().collection("ServiceOrder").find(query).sort({ createdAt: -1 }).limit(500).toArray();
    const stats = { open: orders.filter((o: any) => !terminal(o.status)).length, repairing: orders.filter((o: any) => o.status === "repairing").length, awaitingApproval: orders.filter((o: any) => o.status === "awaiting_approval").length, pendingBalance: orders.reduce((s: number, o: any) => s + Math.max(0, Number(o.total || 0) - Number(o.paid || 0)), 0) };
    return NextResponse.json({ orders, stats });
  } catch (error) { console.error("GET /api/service-orders", error); return NextResponse.json({ error: "No se pudieron cargar las órdenes" }, { status: 500 }); }
  finally { await client.close(); }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const customer = typeof body.customer === "string" ? body.customer.trim() : "", phone = typeof body.phone === "string" ? body.phone.trim() : "", device = typeof body.device === "string" ? body.device.trim() : "", imei = typeof body.imei === "string" ? body.imei.trim() : "", serial = typeof body.serial === "string" ? body.serial.trim() : "", issue = typeof body.issue === "string" ? body.issue.trim() : "";
    const status = STATUSES.includes(body.status) ? body.status : "received", total = money(body.total ?? 0), paid = money(body.paid ?? 0);
    if (!customer || !phone || !device || !issue) return NextResponse.json({ error: "Cliente, teléfono, equipo y falla son obligatorios" }, { status: 400 });
    if (total === null || paid === null || paid > total) return NextResponse.json({ error: "Valores de dinero inválidos" }, { status: 400 });
    const client = await db();
    try {
      const collection = client.db().collection("ServiceOrder"), now = new Date(), count = await collection.countDocuments({ userId: session.id });
      const order = { orderNumber: `ST-${String(count + 1).padStart(5, "0")}`, userId: session.id, customer, phone, device, imei, serial, issue, status, diagnosis: "", technicianNotes: "", technicianId: "", total, paid, balance: total - paid, parts: [], payments: [], statusHistory: [{ status, at: now, by: session.id }], createdAt: now, updatedAt: now, createdBy: session.id, updatedBy: session.id };
      const result = await collection.insertOne(order), saved = { ...order, _id: result.insertedId };
      await writeAuditLog({ userId: session.id, action: "SERVICE_ORDER_CREATED", entityType: "ServiceOrder", entityId: String(result.insertedId), details: { orderNumber: order.orderNumber, customer, device, status } });
      return NextResponse.json(saved, { status: 201 });
    } finally { await client.close(); }
  } catch (error) { console.error("POST /api/service-orders", error); return NextResponse.json({ error: "No se pudo crear la orden" }, { status: 500 }); }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json();
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });
  const client = await db();
  try {
    const orders = client.db().collection("ServiceOrder"), existing = await orders.findOne({ _id: new ObjectId(id), userId: session.id });
    if (!existing) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    const action = body.action as string | undefined;
    if (terminal(existing.status) && action !== undefined) return NextResponse.json({ error: "La orden está cerrada y no admite operaciones" }, { status: 409 });

    if (action === "add_part") {
      const productId = typeof body.productId === "string" && ObjectId.isValid(body.productId) ? body.productId : "";
      const quantity = Number(body.quantity);
      if (!productId || !Number.isInteger(quantity) || quantity <= 0) return NextResponse.json({ error: "Producto y cantidad válidos son obligatorios" }, { status: 400 });
      const product = await client.db().collection("Product").findOne({ _id: new ObjectId(productId), userId: session.id, deletedAt: { $in: [null, undefined] } });
      if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
      const unitPrice = money(product.price); if (unitPrice === null) return NextResponse.json({ error: "Precio del producto inválido" }, { status: 400 });
      const part = { id: new ObjectId().toString(), productId, name: String(product.name), sku: String(product.sku || ""), quantity, unitPrice, subtotal: quantity * unitPrice, consumed: false, warehouseId: "", warehouseName: "", addedAt: new Date(), addedBy: session.id };
      const parts = [...((existing.parts as any[]) || []), part];
      const subtotalParts = parts.reduce((sum, p) => sum + Number(p.subtotal || 0), 0);
      const total = Math.max(0, subtotalParts + Number(existing.labor || 0) - Number(existing.discount || 0));
      await orders.updateOne({ _id: existing._id }, { $set: { parts, total, balance: total - Number(existing.paid || 0), updatedAt: new Date(), updatedBy: session.id } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_PART_ADDED", entityType: "ServiceOrder", entityId: id, details: { part } });
      return NextResponse.json(await orders.findOne({ _id: existing._id }));
    }

    if (action === "set_labor") {
      const labor = money(body.amount); if (labor === null) return NextResponse.json({ error: "Mano de obra inválida" }, { status: 400 });
      const parts = (existing.parts as any[]) || [], subtotalParts = parts.reduce((sum, p) => sum + Number(p.subtotal || 0), 0), discount = Number(existing.discount || 0), total = Math.max(0, subtotalParts + labor - discount);
      if (Number(existing.paid || 0) > total) return NextResponse.json({ error: "La mano de obra no puede reducir el total por debajo de lo ya pagado" }, { status: 400 });
      await orders.updateOne({ _id: existing._id }, { $set: { labor, total, balance: total - Number(existing.paid || 0), updatedAt: new Date(), updatedBy: session.id } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_LABOR_UPDATED", entityType: "ServiceOrder", entityId: id, details: { labor, total } });
      return NextResponse.json(await orders.findOne({ _id: existing._id }));
    }

    if (action === "set_discount") {
      const discount = money(body.amount); if (discount === null) return NextResponse.json({ error: "Descuento inválido" }, { status: 400 });
      const parts = (existing.parts as any[]) || [], subtotalParts = parts.reduce((sum, p) => sum + Number(p.subtotal || 0), 0), labor = Number(existing.labor || 0), total = Math.max(0, subtotalParts + labor - discount);
      if (Number(existing.paid || 0) > total) return NextResponse.json({ error: "El descuento no puede dejar el total por debajo de lo ya pagado" }, { status: 400 });
      await orders.updateOne({ _id: existing._id }, { $set: { discount, total, balance: total - Number(existing.paid || 0), updatedAt: new Date(), updatedBy: session.id } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_DISCOUNT_UPDATED", entityType: "ServiceOrder", entityId: id, details: { discount, total } });
      return NextResponse.json(await orders.findOne({ _id: existing._id }));
    }

    if (action === "consume_part") {
      const partId = typeof body.partId === "string" ? body.partId : "", warehouseId = typeof body.warehouseId === "string" && ObjectId.isValid(body.warehouseId) ? body.warehouseId : "";
      const part = ((existing.parts as any[]) || []).find(p => p.id === partId);
      if (!part || part.consumed) return NextResponse.json({ error: "Repuesto no encontrado o ya consumido" }, { status: 400 });
      if (!warehouseId) return NextResponse.json({ error: "Selecciona la bodega antes de descontar inventario" }, { status: 400 });
      const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, userId: session.id, status: true } });
      if (!warehouse) return NextResponse.json({ error: "La bodega seleccionada no existe, está inactiva o no pertenece a tu cuenta" }, { status: 400 });
      const products = client.db().collection("Product"), movements = client.db().collection("InventoryMovement"), product = await products.findOne({ _id: new ObjectId(part.productId), userId: session.id });
      if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
      const qty = Long.fromNumber(Number(part.quantity)); const current = Long.fromValue(product.quantity as any);
      if (current.lt(qty)) return NextResponse.json({ error: `Stock insuficiente. Disponible: ${current.toString()}` }, { status: 400 });
      const newStock = current.subtract(qty);
      const result = await products.updateOne({ _id: product._id, userId: session.id, quantity: { $gte: qty } }, { $set: { quantity: newStock, updatedAt: new Date(), updatedBy: session.id } });
      if (!result.modifiedCount) return NextResponse.json({ error: "El stock cambió; vuelve a intentar" }, { status: 409 });
      const parts = ((existing.parts as any[]) || []).map(p => p.id === partId ? { ...p, consumed: true, warehouseId, warehouseName: warehouse.name, consumedAt: new Date(), consumedBy: session.id } : p);
      await orders.updateOne({ _id: existing._id }, { $set: { parts, updatedAt: new Date(), updatedBy: session.id } });
      await movements.insertOne({ productId: product._id, warehouseId: new ObjectId(warehouseId), userId: new ObjectId(session.id), type: "exit", quantity: qty, previousStock: current, newStock, reason: "service_order", referenceId: id, notes: existing.orderNumber, createdAt: new Date() });
      await writeAuditLog({ userId: session.id, action: "SERVICE_PART_CONSUMED", entityType: "ServiceOrder", entityId: id, details: { partId, productId: part.productId, quantity: Number(part.quantity), warehouseId, warehouseName: warehouse.name } });
      return NextResponse.json(await orders.findOne({ _id: existing._id }));
    }

    if (action === "payment") {
      const amount = money(body.amount), method = typeof body.paymentMethod === "string" ? body.paymentMethod.trim() : "";
      if (amount === null || amount <= 0 || !method) return NextResponse.json({ error: "Pago inválido" }, { status: 400 });
      const total = Number(existing.total || 0), paid = Number(existing.paid || 0), balance = Math.max(0, total - paid);
      if (amount > balance) return NextResponse.json({ error: "El pago supera el saldo pendiente" }, { status: 400 });
      const nextPaid = paid + amount, nextBalance = total - nextPaid, payment = { id: new ObjectId().toString(), amount, paymentMethod: method, at: new Date(), by: session.id };
      await orders.updateOne({ _id: existing._id }, { $set: { paid: nextPaid, balance: nextBalance, updatedAt: new Date(), updatedBy: session.id }, $push: { payments: payment } });
      await client.db().collection("CashMovement").insertOne({ type: "income", source: "service_order", amount, paymentMethod: method, orderId: existing._id, orderNumber: existing.orderNumber, userId: new ObjectId(session.id), createdBy: new ObjectId(session.id), description: `Abono ${existing.orderNumber}`, createdAt: new Date() });
      await writeAuditLog({ userId: session.id, action: "SERVICE_PAYMENT_RECORDED", entityType: "ServiceOrder", entityId: id, details: payment });
      return NextResponse.json(await orders.findOne({ _id: existing._id }));
    }

    const update: any = { updatedAt: new Date(), updatedBy: session.id };
    for (const key of ["customer", "phone", "device", "imei", "serial", "issue", "diagnosis", "technicianNotes", "technicianId"]) if (body[key] !== undefined) update[key] = typeof body[key] === "string" ? body[key].trim() : body[key];
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
      if (body.status === "delivered" && Number(existing.balance || 0) > 0) return NextResponse.json({ error: "No se puede entregar una orden con saldo pendiente" }, { status: 409 });
      if (body.status === "delivered" && !existing.diagnosis?.trim()) return NextResponse.json({ error: "Registra el diagnóstico antes de entregar la orden" }, { status: 409 });
      update.status = body.status;
    }
    if (body.total !== undefined) update.total = money(body.total); if (body.paid !== undefined) update.paid = money(body.paid);
    if (update.total === null || update.paid === null || (update.total !== undefined && update.paid !== undefined && update.paid > update.total)) return NextResponse.json({ error: "Valores de dinero inválidos" }, { status: 400 });
    const total = update.total !== undefined ? update.total : Number(existing.total || 0), paid = update.paid !== undefined ? update.paid : Number(existing.paid || 0); update.balance = total - paid;
    const push: any = {}; if (update.status && update.status !== existing.status) push.statusHistory = { status: update.status, at: new Date(), by: session.id };
    if (update.status === "delivered") update.deliveredAt = new Date();
    await orders.updateOne({ _id: existing._id }, { $set: update, ...(Object.keys(push).length ? { $push: push } : {}) });
    const saved = await orders.findOne({ _id: existing._id });
    await writeAuditLog({ userId: session.id, action: "SERVICE_ORDER_UPDATED", entityType: "ServiceOrder", entityId: id, details: { changes: update } });
    return NextResponse.json(saved);
  } catch (error) { console.error("PUT /api/service-orders", error); return NextResponse.json({ error: "No se pudo actualizar la orden" }, { status: 500 }); }
  finally { await client.close(); }
}
