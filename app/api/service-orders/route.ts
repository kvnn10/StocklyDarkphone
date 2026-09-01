import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/prisma/client";

const STATUSES = ["received", "diagnosis", "awaiting_approval", "repairing", "ready", "delivered", "cancelled"] as const;
type Status = (typeof STATUSES)[number];
const allowed = (session: any) => !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
const money = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; };
const terminal = (status: string) => status === "delivered" || status === "cancelled";
const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const meta = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

function legacyOrder(order: any) {
  if (!order) return null;
  const m = meta(order.accessories);
  const parts = (order.items ?? []).map((item: any) => ({ id: item.id, productId: item.productId ?? "", name: item.productName, sku: item.sku ?? "", quantity: item.quantity, unitPrice: item.unitPrice, unitCost: item.unitCost, subtotal: item.subtotal, costSubtotal: item.quantity * item.unitCost, consumed: item.inventoryApplied, warehouseId: item.warehouseId ?? "", warehouseName: m.partWarehouses?.[item.id] ?? "", addedAt: item.createdAt, addedBy: order.createdBy }));
  const payments = (order.payments ?? []).map((p: any) => ({ id: p.id, amount: p.amount, paymentMethod: p.paymentMethod, at: p.createdAt, by: p.recordedBy }));
  return { ...order, _id: order.id, customer: m.customerName ?? "", phone: m.customerPhone ?? "", device: [order.brand, order.model].filter(Boolean).join(" ").trim(), imei: order.imei ?? "", serial: order.serialNumber ?? "", issue: order.reportedIssue, technicianNotes: order.workPerformed ?? "", labor: order.laborAmount, paid: order.amountPaid, balance: order.amountDue, parts, payments, statusHistory: Array.isArray(m.statusHistory) ? m.statusHistory : [{ status: order.status, at: order.createdAt, by: order.createdBy }], photos: Array.isArray(m.photos) ? m.photos : [], warrantyDays: order.warrantyDays, warrantyUntil: order.warrantyExpiresAt };
}

async function getOrder(id: string, userId: string) {
  return prisma.serviceOrder.findFirst({ where: { id, userId }, include: { items: true, payments: true } });
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
      const or: Prisma.ServiceOrderWhereInput[] = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { deviceType: { contains: search, mode: "insensitive" } },
        { brand: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
        { imei: { contains: search, mode: "insensitive" } },
        { serialNumber: { contains: search, mode: "insensitive" } },
        { reportedIssue: { contains: search, mode: "insensitive" } },
      ];
      if (validId(search)) or.push({ id: search });
      where.OR = or;
    }
    const orders = await prisma.serviceOrder.findMany({ where, include: { items: true, payments: true }, orderBy: { createdAt: "desc" }, take: 500 });
    const serialized = orders.map(legacyOrder);
    return NextResponse.json({ orders: serialized, stats: { open: serialized.filter((o: any) => !terminal(o.status)).length, repairing: serialized.filter((o: any) => o.status === "repairing").length, awaitingApproval: serialized.filter((o: any) => o.status === "awaiting_approval").length, pendingBalance: serialized.reduce((s: number, o: any) => s + Math.max(0, Number(o.amountDue || 0)), 0) } });
  } catch (error) { console.error("GET /api/service-orders", error); return NextResponse.json({ error: "No se pudieron cargar las órdenes" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const customer = typeof body.customer === "string" ? body.customer.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const device = typeof body.device === "string" ? body.device.trim() : "";
    const deviceType = typeof body.deviceType === "string" && body.deviceType.trim() ? body.deviceType.trim() : "phone";
    const brand = typeof body.brand === "string" ? body.brand.trim() : "";
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : device;
    const imei = typeof body.imei === "string" ? body.imei.trim() : "";
    const serial = typeof body.serial === "string" ? body.serial.trim() : typeof body.serialNumber === "string" ? body.serialNumber.trim() : "";
    const issue = typeof body.issue === "string" ? body.issue.trim() : typeof body.reportedIssue === "string" ? body.reportedIssue.trim() : "";
    const status = STATUSES.includes(body.status) ? body.status : "received";
    const total = money(body.total ?? 0), paid = money(body.paid ?? body.amountPaid ?? 0);
    if (!customer || !phone || !model || !issue) return NextResponse.json({ error: "Cliente, teléfono, equipo y falla son obligatorios" }, { status: 400 });
    if (total === null || paid === null || paid > total) return NextResponse.json({ error: "Valores de dinero inválidos" }, { status: 400 });
    const now = new Date();
    const created = await prisma.serviceOrder.create({ data: { orderNumber: `ST-${Date.now().toString().slice(-10)}`, userId: session.id, deviceType, brand, model, imei: imei || null, serialNumber: serial || null, reportedIssue: issue, status, total, amountPaid: paid, amountDue: total - paid, accessories: { customerName: customer, customerPhone: phone, statusHistory: [{ status, at: now.toISOString(), by: session.id }], photos: [], partWarranties: {}, partWarehouses: {} }, createdBy: session.id, updatedBy: session.id }, include: { items: true, payments: true } });
    await writeAuditLog({ userId: session.id, action: "SERVICE_ORDER_CREATED", entityType: "ServiceOrder", entityId: created.id, details: { orderNumber: created.orderNumber, customer, device: model, status } });
    return NextResponse.json(legacyOrder(created), { status: 201 });
  } catch (error) { console.error("POST /api/service-orders", error); return NextResponse.json({ error: "No se pudo crear la orden" }, { status: 500 }); }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    if (!validId(id)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });
    const existing = await getOrder(id, session.id);
    if (!existing) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    const action = typeof body.action === "string" ? body.action : undefined;
    if (terminal(existing.status) && action !== undefined) return NextResponse.json({ error: "La orden está cerrada y no admite operaciones" }, { status: 409 });

    if (action === "add_part") {
      const productId = validId(body.productId) ? body.productId : "";
      const quantity = Number(body.quantity);
      if (!productId || !Number.isInteger(quantity) || quantity <= 0) return NextResponse.json({ error: "Producto y cantidad válidos son obligatorios" }, { status: 400 });
      const product = await prisma.product.findFirst({ where: { id: productId, userId: session.id, deletedAt: null } });
      if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
      const unitPrice = money(product.price), unitCost = money(product.purchasePrice) ?? 0;
      if (unitPrice === null) return NextResponse.json({ error: "Precio del producto inválido" }, { status: 400 });
      try {
        await prisma.$transaction(async tx => {
          await tx.serviceOrderItem.create({ data: { serviceOrderId: id, productId, productName: product.name, sku: product.sku || null, quantity, unitPrice, unitCost, subtotal: quantity * unitPrice } });
          const partsAmount = existing.items.reduce((sum, i) => sum + Number(i.subtotal), 0) + quantity * unitPrice;
          const total = Math.max(0, partsAmount + existing.laborAmount - existing.discount);
          if (existing.amountPaid > total) throw new Error("El nuevo total no puede ser menor a lo ya pagado");
          await tx.serviceOrder.update({ where: { id }, data: { partsAmount, total, amountDue: total - existing.amountPaid, updatedAt: new Date(), updatedBy: session.id } });
        });
      } catch (error: any) { if (error?.message === "El nuevo total no puede ser menor a lo ya pagado") return NextResponse.json({ error: error.message }, { status: 400 }); throw error; }
      await writeAuditLog({ userId: session.id, action: "SERVICE_PART_ADDED", entityType: "ServiceOrder", entityId: id, details: { productId, quantity } });
      return NextResponse.json(legacyOrder(await getOrder(id, session.id)));
    }

    if (action === "set_labor" || action === "set_discount") {
      const value = money(body.amount); if (value === null) return NextResponse.json({ error: action === "set_labor" ? "Mano de obra inválida" : "Descuento inválido" }, { status: 400 });
      const partsAmount = existing.items.reduce((sum, i) => sum + Number(i.subtotal), 0);
      const labor = action === "set_labor" ? value : existing.laborAmount;
      const discount = action === "set_discount" ? value : existing.discount;
      const total = Math.max(0, partsAmount + labor - discount);
      if (existing.amountPaid > total) return NextResponse.json({ error: "El cambio no puede reducir el total por debajo de lo ya pagado" }, { status: 400 });
      const saved = await prisma.serviceOrder.update({ where: { id }, data: { laborAmount: labor, discount, partsAmount, total, amountDue: total - existing.amountPaid, updatedAt: new Date(), updatedBy: session.id }, include: { items: true, payments: true } });
      await writeAuditLog({ userId: session.id, action: action === "set_labor" ? "SERVICE_LABOR_UPDATED" : "SERVICE_DISCOUNT_UPDATED", entityType: "ServiceOrder", entityId: id, details: { value, total } });
      return NextResponse.json(legacyOrder(saved));
    }

    if (action === "consume_part") {
      const partId = typeof body.partId === "string" ? body.partId : "";
      const warehouseId = validId(body.warehouseId) ? body.warehouseId : "";
      const item = existing.items.find(i => i.id === partId);
      if (!item || !item.productId || item.inventoryApplied) return NextResponse.json({ error: "Repuesto no encontrado o ya consumido" }, { status: 400 });
      if (!warehouseId) return NextResponse.json({ error: "Selecciona la bodega antes de descontar inventario" }, { status: 400 });
      const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, userId: session.id, status: true } });
      if (!warehouse) return NextResponse.json({ error: "La bodega seleccionada no existe, está inactiva o no pertenece a tu cuenta" }, { status: 400 });
      try {
        await prisma.$transaction(async tx => {
          const product = await tx.product.findFirst({ where: { id: item.productId!, userId: session.id, deletedAt: null } });
          if (!product) throw new Error("Producto no encontrado");
          const qty = BigInt(item.quantity);
          const allocation = await tx.stockAllocation.findFirst({ where: { productId: product.id, warehouseId, userId: session.id } });
          if (!allocation) throw new Error("No existe stock asignado de este producto en la bodega seleccionada");
          const allocated = await tx.stockAllocation.updateMany({ where: { id: allocation.id, productId: product.id, warehouseId, userId: session.id, quantity: { gte: qty } }, data: { quantity: { decrement: qty }, updatedAt: new Date() } });
          if (allocated.count !== 1) throw new Error(`Stock insuficiente en la bodega seleccionada. Disponible: ${allocation.quantity.toString()}`);
          const updated = await tx.product.updateMany({ where: { id: product.id, userId: session.id, deletedAt: null, quantity: { gte: qty } }, data: { quantity: { decrement: qty }, updatedAt: new Date(), updatedBy: session.id } });
          if (updated.count !== 1) throw new Error(`Stock global insuficiente. Disponible: ${product.quantity.toString()}`);
          await tx.serviceOrderItem.update({ where: { id: item.id }, data: { inventoryApplied: true, warehouseId } });
          await tx.inventoryMovement.create({ data: { productId: product.id, warehouseId, userId: session.id, type: "exit", quantity: qty, previousStock: product.quantity, newStock: product.quantity - qty, reason: "service_order", referenceId: id, notes: existing.orderNumber } });
        });
      } catch (error: any) {
        if (error?.message === "Producto no encontrado" || error?.message === "No existe stock asignado de este producto en la bodega seleccionada" || error?.message?.startsWith("Stock insuficiente") || error?.message?.startsWith("Stock global insuficiente")) return NextResponse.json({ error: error.message }, { status: 400 });
        throw error;
      }
      const m = meta(existing.accessories);
      await prisma.serviceOrder.update({ where: { id }, data: { accessories: { ...m, partWarehouses: { ...(m.partWarehouses ?? {}), [partId]: warehouse.name } }, updatedAt: new Date(), updatedBy: session.id } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_PART_CONSUMED", entityType: "ServiceOrder", entityId: id, details: { partId, productId: item.productId, quantity: item.quantity, warehouseId } });
      return NextResponse.json(legacyOrder(await getOrder(id, session.id)));
    }

    if (action === "payment") {
      const amount = money(body.amount), method = typeof body.paymentMethod === "string" ? body.paymentMethod.trim() : "";
      if (amount === null || amount <= 0 || !method) return NextResponse.json({ error: "Pago inválido" }, { status: 400 });
      try {
        const saved = await prisma.$transaction(async tx => {
          const current = await tx.serviceOrder.findFirst({ where: { id, userId: session.id } });
          if (!current) throw new Error("Orden no encontrada");
          if (amount > current.amountDue) throw new Error("El pago supera el saldo pendiente");
          const updated = await tx.serviceOrder.updateMany({ where: { id, userId: session.id, amountDue: { gte: amount } }, data: { amountPaid: { increment: amount }, amountDue: { decrement: amount }, updatedAt: new Date(), updatedBy: session.id } });
          if (updated.count !== 1) throw new Error("El saldo cambió mientras se registraba el pago. Intenta nuevamente");
          await tx.serviceOrderPayment.create({ data: { serviceOrderId: id, userId: session.id, recordedBy: session.id, amount, paymentMethod: method } });
          await tx.cashMovement.create({ data: { type: "income", source: "service_order", amount, paymentMethod: method, orderId: id, orderNumber: current.orderNumber, userId: session.id, createdBy: session.id, description: `Abono ${current.orderNumber}` } });
          return tx.serviceOrder.findUnique({ where: { id }, include: { items: true, payments: true } });
        });
        await writeAuditLog({ userId: session.id, action: "SERVICE_PAYMENT_RECORDED", entityType: "ServiceOrder", entityId: id, details: { amount, paymentMethod: method } });
        return NextResponse.json(legacyOrder(saved));
      } catch (error: any) {
        if (error?.message === "Orden no encontrada" || error?.message === "El pago supera el saldo pendiente" || error?.message === "El saldo cambió mientras se registraba el pago. Intenta nuevamente") return NextResponse.json({ error: error.message }, { status: error?.message === "Orden no encontrada" ? 404 : 400 });
        throw error;
      }
    }

    const currentMeta = meta(existing.accessories);
    const nextMeta = { ...currentMeta };
    const update: any = { updatedAt: new Date(), updatedBy: session.id };
    if (body.customer !== undefined) nextMeta.customerName = typeof body.customer === "string" ? body.customer.trim() : body.customer;
    if (body.phone !== undefined) nextMeta.customerPhone = typeof body.phone === "string" ? body.phone.trim() : body.phone;
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
      if (body.status === "delivered" && existing.amountDue > 0) return NextResponse.json({ error: "No se puede entregar una orden con saldo pendiente" }, { status: 409 });
      if (body.status === "delivered" && !existing.diagnosis?.trim()) return NextResponse.json({ error: "Registra el diagnóstico antes de entregar la orden" }, { status: 409 });
      update.status = body.status;
      nextMeta.statusHistory = [...(Array.isArray(currentMeta.statusHistory) ? currentMeta.statusHistory : []), { status: body.status, at: new Date().toISOString(), by: session.id }];
      if (body.status === "delivered") update.deliveredAt = new Date();
    }
    const map: Record<string, string> = { imei: "imei", serial: "serialNumber", issue: "reportedIssue", diagnosis: "diagnosis", technicianNotes: "workPerformed", technicianId: "technicianId", brand: "brand", model: "model" };
    for (const [from, to] of Object.entries(map)) if (body[from] !== undefined) update[to] = typeof body[from] === "string" ? body[from].trim() || null : body[from];
    if (body.device !== undefined && typeof body.device === "string") update.model = body.device.trim();
    if (body.total !== undefined || body.paid !== undefined) {
      const total = body.total !== undefined ? money(body.total) : existing.total;
      const paid = body.paid !== undefined ? money(body.paid) : existing.amountPaid;
      if (total === null || paid === null || paid > total) return NextResponse.json({ error: "Valores de dinero inválidos" }, { status: 400 });
      update.total = total; update.amountPaid = paid; update.amountDue = total - paid;
    }
    update.accessories = nextMeta;
    const saved = await prisma.serviceOrder.update({ where: { id }, data: update, include: { items: true, payments: true } });
    await writeAuditLog({ userId: session.id, action: "SERVICE_ORDER_UPDATED", entityType: "ServiceOrder", entityId: id, details: { fields: Object.keys(update) } });
    return NextResponse.json(legacyOrder(saved));
  } catch (error) { console.error("PUT /api/service-orders", error); return NextResponse.json({ error: "No se pudo actualizar la orden" }, { status: 500 }); }
}
