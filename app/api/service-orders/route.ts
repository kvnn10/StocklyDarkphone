import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/prisma/client";

const STATUSES = ["received", "diagnosis", "awaiting_approval", "repairing", "ready", "delivered", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

function allowed(session: any) { return !!session && ["admin", "user", "retailer"].includes(session.role ?? ""); }
const money = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; };
const terminal = (status: string) => status === "delivered" || status === "cancelled";
const validObjectId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

function legacyOrder(order: any) {
  const parts = (order.items ?? []).map((item: any) => ({
    id: item.id,
    productId: item.productId ?? "",
    name: item.productName,
    sku: item.sku ?? "",
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    unitCost: item.unitCost,
    subtotal: item.subtotal,
    costSubtotal: item.quantity * item.unitCost,
    consumed: item.inventoryApplied,
    warehouseId: item.warehouseId ?? "",
    warehouseName: item.warehouse?.name ?? "",
    addedAt: item.createdAt,
    addedBy: order.createdBy,
  }));
  const payments = (order.payments ?? []).map((payment: any) => ({ id: payment.id, amount: payment.amount, paymentMethod: payment.paymentMethod, at: payment.createdAt, by: payment.recordedBy }));
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [{ status: order.status, at: order.createdAt, by: order.createdBy }];
  return {
    ...order,
    _id: order.id,
    customer: order.customerName ?? "",
    phone: order.customerPhone ?? "",
    device: [order.brand, order.model].filter(Boolean).join(" ").trim() || order.model,
    imei: order.imei ?? "",
    serial: order.serialNumber ?? "",
    issue: order.reportedIssue,
    technicianNotes: order.workPerformed ?? "",
    labor: order.laborAmount,
    paid: order.amountPaid,
    balance: order.amountDue,
    parts: parts,
    payments,
    statusHistory: history,
    items: undefined,
  };
}

async function getOrder(id: string, userId: string) {
  return prisma.serviceOrder.findFirst({
    where: { id, userId },
    include: { items: true, payments: true },
  });
}

function errorResponse(error: unknown, fallback: string) {
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const params = new URL(request.url).searchParams;
    const search = params.get("search")?.trim() ?? "";
    const status = params.get("status")?.trim() ?? "";
    const where: Prisma.ServiceOrderWhereInput = { userId: session.id };
    if (status && STATUSES.includes(status as Status)) where.status = status;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { customerName: { contains: search, mode: "insensitive" } },
        { customerPhone: { contains: search, mode: "insensitive" } },
        { deviceType: { contains: search, mode: "insensitive" } },
        { brand: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
        { imei: { contains: search, mode: "insensitive" } },
        { serialNumber: { contains: search, mode: "insensitive" } },
        { reportedIssue: { contains: search, mode: "insensitive" } },
      ];
      if (validObjectId(search)) where.OR.push({ id: search });
    }
    const orders = await prisma.serviceOrder.findMany({ where, include: { items: true, payments: true }, orderBy: { createdAt: "desc" }, take: 500 });
    const serialized = orders.map(legacyOrder);
    const stats = {
      open: serialized.filter((o: any) => !terminal(o.status)).length,
      repairing: serialized.filter((o: any) => o.status === "repairing").length,
      awaitingApproval: serialized.filter((o: any) => o.status === "awaiting_approval").length,
      pendingBalance: serialized.reduce((sum: number, o: any) => sum + Math.max(0, Number(o.amountDue || 0)), 0),
    };
    return NextResponse.json({ orders: serialized, stats });
  } catch (error) { return errorResponse(error, "No se pudieron cargar las órdenes"); }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const customer = typeof body.customer === "string" ? body.customer.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const rawDevice = typeof body.device === "string" ? body.device.trim() : "";
    const deviceType = typeof body.deviceType === "string" && body.deviceType.trim() ? body.deviceType.trim() : "phone";
    const brand = typeof body.brand === "string" ? body.brand.trim() : "";
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : rawDevice;
    const imei = typeof body.imei === "string" ? body.imei.trim() : "";
    const serialNumber = typeof body.serial === "string" ? body.serial.trim() : typeof body.serialNumber === "string" ? body.serialNumber.trim() : "";
    const reportedIssue = typeof body.issue === "string" ? body.issue.trim() : typeof body.reportedIssue === "string" ? body.reportedIssue.trim() : "";
    const status = STATUSES.includes(body.status) ? body.status : "received";
    const total = money(body.total ?? 0), paid = money(body.paid ?? body.amountPaid ?? 0);
    if (!customer || !phone || !model || !reportedIssue) return NextResponse.json({ error: "Cliente, teléfono, equipo y falla son obligatorios" }, { status: 400 });
    if (total === null || paid === null || paid > total) return NextResponse.json({ error: "Valores de dinero inválidos" }, { status: 400 });

    const orderNumber = `ST-${Date.now().toString().slice(-10)}`;
    const now = new Date();
    const created = await prisma.serviceOrder.create({
      data: {
        orderNumber,
        userId: session.id,
        customerName: customer,
        customerPhone: phone,
        deviceType,
        brand,
        model,
        imei: imei || null,
        serialNumber: serialNumber || null,
        reportedIssue,
        status,
        total,
        amountPaid: paid,
        amountDue: total - paid,
        laborAmount: 0,
        partsAmount: 0,
        discount: 0,
        statusHistory: [{ status, at: now.toISOString(), by: session.id }],
        createdBy: session.id,
        updatedBy: session.id,
      },
      include: { items: true, payments: true },
    });
    await writeAuditLog({ userId: session.id, action: "SERVICE_ORDER_CREATED", entityType: "ServiceOrder", entityId: created.id, details: { orderNumber, customer, device: model, status } });
    return NextResponse.json(legacyOrder(created), { status: 201 });
  } catch (error) { return errorResponse(error, "No se pudo crear la orden"); }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    if (!validObjectId(id)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });
    const existing = await getOrder(id, session.id);
    if (!existing) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    const action = typeof body.action === "string" ? body.action : undefined;
    if (terminal(existing.status) && action !== undefined) return NextResponse.json({ error: "La orden está cerrada y no admite operaciones" }, { status: 409 });

    if (action === "add_part") {
      const productId = validObjectId(body.productId) ? body.productId : "";
      const quantity = Number(body.quantity);
      if (!productId || !Number.isInteger(quantity) || quantity <= 0) return NextResponse.json({ error: "Producto y cantidad válidos son obligatorios" }, { status: 400 });
      const product = await prisma.product.findFirst({ where: { id: productId, userId: session.id, deletedAt: null } });
      if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
      const unitPrice = money(product.price), unitCost = money(product.purchasePrice) ?? 0;
      if (unitPrice === null) return NextResponse.json({ error: "Precio del producto inválido" }, { status: 400 });
      const part = await prisma.$transaction(async tx => {
        const item = await tx.serviceOrderItem.create({ data: { serviceOrderId: id, productId, productName: product.name, sku: product.sku || null, quantity, unitPrice, unitCost, subtotal: quantity * unitPrice } });
        const partsAmount = existing.items.reduce((sum, i) => sum + Number(i.subtotal), 0) + item.subtotal;
        const total = Math.max(0, partsAmount + existing.laborAmount - existing.discount);
        if (existing.amountPaid > total) throw new Error("El nuevo total no puede ser menor a lo ya pagado");
        await tx.serviceOrder.update({ where: { id }, data: { partsAmount, total, amountDue: total - existing.amountPaid, updatedAt: new Date(), updatedBy: session.id } });
        return item;
      });
      await writeAuditLog({ userId: session.id, action: "SERVICE_PART_ADDED", entityType: "ServiceOrder", entityId: id, details: { productId, quantity, itemId: part.id } });
      const saved = await getOrder(id, session.id);
      return NextResponse.json(legacyOrder(saved));
    }

    if (action === "set_labor") {
      const labor = money(body.amount); if (labor === null) return NextResponse.json({ error: "Mano de obra inválida" }, { status: 400 });
      const partsAmount = existing.items.reduce((sum, i) => sum + Number(i.subtotal), 0);
      const total = Math.max(0, partsAmount + labor - existing.discount);
      if (existing.amountPaid > total) return NextResponse.json({ error: "La mano de obra no puede reducir el total por debajo de lo ya pagado" }, { status: 400 });
      const saved = await prisma.serviceOrder.update({ where: { id }, data: { laborAmount: labor, partsAmount, total, amountDue: total - existing.amountPaid, updatedAt: new Date(), updatedBy: session.id }, include: { items: true, payments: true } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_LABOR_UPDATED", entityType: "ServiceOrder", entityId: id, details: { labor, total } });
      return NextResponse.json(legacyOrder(saved));
    }

    if (action === "set_discount") {
      const discount = money(body.amount); if (discount === null) return NextResponse.json({ error: "Descuento inválido" }, { status: 400 });
      const partsAmount = existing.items.reduce((sum, i) => sum + Number(i.subtotal), 0);
      const total = Math.max(0, partsAmount + existing.laborAmount - discount);
      if (existing.amountPaid > total) return NextResponse.json({ error: "El descuento no puede dejar el total por debajo de lo ya pagado" }, { status: 400 });
      const saved = await prisma.serviceOrder.update({ where: { id }, data: { discount, partsAmount, total, amountDue: total - existing.amountPaid, updatedAt: new Date(), updatedBy: session.id }, include: { items: true, payments: true } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_DISCOUNT_UPDATED", entityType: "ServiceOrder", entityId: id, details: { discount, total } });
      return NextResponse.json(legacyOrder(saved));
    }

    if (action === "consume_part") {
      const partId = typeof body.partId === "string" ? body.partId : "";
      const warehouseId = validObjectId(body.warehouseId) ? body.warehouseId : "";
      if (!partId || !warehouseId) return NextResponse.json({ error: "Repuesto y bodega válidos son obligatorios" }, { status: 400 });
      const item = existing.items.find(i => i.id === partId);
      if (!item || !item.productId || item.inventoryApplied) return NextResponse.json({ error: "Repuesto no encontrado o ya consumido" }, { status: 400 });
      const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, userId: session.id, status: true } });
      if (!warehouse) return NextResponse.json({ error: "La bodega seleccionada no existe, está inactiva o no pertenece a tu cuenta" }, { status: 400 });
      await prisma.$transaction(async tx => {
        const product = await tx.product.findFirst({ where: { id: item.productId!, userId: session.id, deletedAt: null } });
        if (!product) throw new Error("Producto no encontrado");
        const qty = BigInt(item.quantity);
        const updated = await tx.product.updateMany({ where: { id: product.id, userId: session.id, quantity: { gte: qty } }, data: { quantity: { decrement: qty }, updatedAt: new Date(), updatedBy: session.id } });
        if (updated.count !== 1) throw new Error(`Stock insuficiente. Disponible: ${product.quantity.toString()}`);
        const newStock = product.quantity - qty;
        await tx.serviceOrderItem.update({ where: { id: item.id }, data: { inventoryApplied: true, warehouseId, } });
        await tx.inventoryMovement.create({ data: { productId: product.id, warehouseId, userId: session.id, type: "exit", quantity: qty, previousStock: product.quantity, newStock, reason: "service_order", referenceId: id, notes: existing.orderNumber } });
      });
      await writeAuditLog({ userId: session.id, action: "SERVICE_PART_CONSUMED", entityType: "ServiceOrder", entityId: id, details: { partId, productId: item.productId, quantity: item.quantity, warehouseId } });
      const saved = await getOrder(id, session.id);
      return NextResponse.json(legacyOrder(saved));
    }

    if (action === "payment") {
      const amount = money(body.amount), method = typeof body.paymentMethod === "string" ? body.paymentMethod.trim() : "";
      if (amount === null || amount <= 0 || !method) return NextResponse.json({ error: "Pago inválido" }, { status: 400 });
      if (amount > existing.amountDue) return NextResponse.json({ error: "El pago supera el saldo pendiente" }, { status: 400 });
      const saved = await prisma.$transaction(async tx => {
        const nextPaid = existing.amountPaid + amount;
        const payment = await tx.serviceOrderPayment.create({ data: { serviceOrderId: id, userId: session.id, recordedBy: session.id, amount, paymentMethod: method } });
        await tx.cashMovement.create({ data: { type: "income", source: "service_order", amount, paymentMethod: method, orderId: id, orderNumber: existing.orderNumber, userId: session.id, createdBy: session.id, description: `Abono ${existing.orderNumber}` } });
        return tx.serviceOrder.update({ where: { id }, data: { amountPaid: nextPaid, amountDue: existing.total - nextPaid, updatedAt: new Date(), updatedBy: session.id }, include: { items: true, payments: true } });
      });
      await writeAuditLog({ userId: session.id, action: "SERVICE_PAYMENT_RECORDED", entityType: "ServiceOrder", entityId: id, details: { amount, paymentMethod: method } });
      return NextResponse.json(legacyOrder(saved));
    }

    const update: any = { updatedAt: new Date(), updatedBy: session.id };
    const stringMap: Record<string, string> = { customer: "customerName", phone: "customerPhone", imei: "imei", serial: "serialNumber", issue: "reportedIssue", diagnosis: "diagnosis", technicianNotes: "workPerformed", technicianId: "technicianId" };
    for (const [from, to] of Object.entries(stringMap)) if (body[from] !== undefined) update[to] = typeof body[from] === "string" ? body[from].trim() || null : body[from];
    if (body.device !== undefined && typeof body.device === "string") update.model = body.device.trim();
    if (body.brand !== undefined && typeof body.brand === "string") update.brand = body.brand.trim();
    if (body.model !== undefined && typeof body.model === "string") update.model = body.model.trim();
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
      if (body.status === "delivered" && existing.amountDue > 0) return NextResponse.json({ error: "No se puede entregar una orden con saldo pendiente" }, { status: 409 });
      if (body.status === "delivered" && !existing.diagnosis?.trim()) return NextResponse.json({ error: "Registra el diagnóstico antes de entregar la orden" }, { status: 409 });
      update.status = body.status;
      update.statusHistory = [...(Array.isArray(existing.statusHistory) ? existing.statusHistory : []), { status: body.status, at: new Date().toISOString(), by: session.id }];
      if (body.status === "delivered") update.deliveredAt = new Date();
    }
    if (body.total !== undefined) {
      const total = money(body.total);
      if (total === null || total < existing.amountPaid) return NextResponse.json({ error: "Total inválido o inferior a lo ya pagado" }, { status: 400 });
      update.total = total;
      update.amountDue = total - existing.amountPaid;
    }
    if (body.paid !== undefined) {
      const paid = money(body.paid);
      const total = update.total !== undefined ? update.total : existing.total;
      if (paid === null || paid > total) return NextResponse.json({ error: "Valores de dinero inválidos" }, { status: 400 });
      update.amountPaid = paid;
      update.amountDue = total - paid;
    }
    const saved = await prisma.serviceOrder.update({ where: { id }, data: update, include: { items: true, payments: true } });
    await writeAuditLog({ userId: session.id, action: "SERVICE_ORDER_UPDATED", entityType: "ServiceOrder", entityId: id, details: { fields: Object.keys(update) } });
    return NextResponse.json(legacyOrder(saved));
  } catch (error: any) {
    if (error?.message === "Producto no encontrado") return NextResponse.json({ error: error.message }, { status: 404 });
    if (typeof error?.message === "string" && error.message.startsWith("Stock insuficiente")) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error?.message === "El nuevo total no puede ser menor a lo ya pagado") return NextResponse.json({ error: error.message }, { status: 400 });
    return errorResponse(error, "No se pudo actualizar la orden");
  }
}
