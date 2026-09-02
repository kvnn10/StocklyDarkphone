import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/prisma/client";

const ROLES = ["admin", "user", "retailer"];
const CLOSED = ["delivered", "cancelled"];
const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const meta = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const jsonError = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function getOrder(id: string, userId: string) {
  return prisma.serviceOrder.findFirst({ where: { id, userId }, include: { items: true, payments: true } });
}

function withHistory(accessories: unknown, entry: Record<string, any>) {
  const current = meta(accessories);
  const history = Array.isArray(current.proHistory) ? current.proHistory : [];
  return { ...current, proHistory: [...history, { ...entry, at: new Date().toISOString() }].slice(-100) };
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role ?? "")) return jsonError("No autorizado", 401);
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (!validId(id)) return jsonError("Orden inválida");
    if (!action) return jsonError("Acción obligatoria");

    const order = await getOrder(id, session.id);
    if (!order) return jsonError("Orden no encontrada", 404);
    if (CLOSED.includes(order.status)) return jsonError("La orden está cerrada y no admite operaciones", 409);

    if (action === "approve_budget" || action === "reject_budget") {
      const approved = action === "approve_budget";
      const current = meta(order.accessories);
      const approval = {
        status: approved ? "approved" : "rejected",
        at: new Date().toISOString(),
        by: session.id,
        note: typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null,
      };
      const accessories = withHistory({ ...current, budgetApproval: approval }, { type: "budget", status: approval.status, by: session.id });
      const saved = await prisma.serviceOrder.update({
        where: { id },
        data: { status: approved ? "repairing" : "cancelled", accessories, updatedAt: new Date(), updatedBy: session.id },
      });
      await writeAuditLog({ userId: session.id, action: approved ? "SERVICE_BUDGET_APPROVED" : "SERVICE_BUDGET_REJECTED", entityType: "ServiceOrder", entityId: id, details: { orderNumber: order.orderNumber, total: order.total, note: approval.note } });
      return NextResponse.json({ id: saved.id, status: saved.status, budgetApproval: approval });
    }

    if (action === "accept_service" || action === "sign_acceptance") {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
      const signature = typeof body.signature === "string" ? body.signature.trim().slice(0, 200000) : "";
      if (!name) return jsonError("Nombre del cliente obligatorio");
      if (action === "sign_acceptance" && !signature) return jsonError("Firma obligatoria");
      const current = meta(order.accessories);
      const acceptance = {
        type: action === "sign_acceptance" ? "signature" : "acceptance",
        accepted: true,
        name,
        signature: signature || null,
        at: new Date().toISOString(),
        by: session.id,
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      };
      const saved = await prisma.serviceOrder.update({ where: { id }, data: { accessories: withHistory({ ...current, clientAcceptance: acceptance }, { type: "client_acceptance", by: session.id }), updatedAt: new Date(), updatedBy: session.id } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_CLIENT_ACCEPTED", entityType: "ServiceOrder", entityId: id, details: { orderNumber: order.orderNumber, name, signed: Boolean(signature) } });
      return NextResponse.json({ id: saved.id, clientAcceptance: acceptance });
    }

    if (action === "reserve_part" || action === "release_part") {
      const productId = validId(body.productId) ? body.productId : "";
      const warehouseId = validId(body.warehouseId) ? body.warehouseId : "";
      const quantity = Number(body.quantity);
      if (!productId || !warehouseId || !Number.isInteger(quantity) || quantity <= 0) return jsonError("Producto, bodega y cantidad válidos son obligatorios");
      const product = await prisma.product.findFirst({ where: { id: productId, userId: session.id, deletedAt: null } });
      if (!product) return jsonError("Producto no encontrado", 404);
      const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, userId: session.id, status: true } });
      if (!warehouse) return jsonError("Bodega no encontrada o inactiva");
      const qty = BigInt(quantity);
      try {
        await prisma.$transaction(async tx => {
          const allocation = await tx.stockAllocation.findFirst({ where: { productId, warehouseId, userId: session.id } });
          if (!allocation) throw new Error("No existe stock asignado en la bodega seleccionada");
          if (action === "reserve_part") {
            const available = allocation.quantity - allocation.reservedQuantity;
            if (available < qty) throw new Error(`Stock disponible para reservar: ${available.toString()}`);
            const updated = await tx.stockAllocation.updateMany({ where: { id: allocation.id, quantity: { gte: qty }, reservedQuantity: { lte: allocation.quantity - qty } }, data: { reservedQuantity: { increment: qty }, updatedAt: new Date() } });
            if (updated.count !== 1) throw new Error("El stock cambió mientras se reservaba el repuesto");
            const productUpdated = await tx.product.updateMany({ where: { id: productId, userId: session.id, quantity: { gte: qty }, reservedQuantity: { lte: product.quantity - qty } }, data: { reservedQuantity: { increment: qty }, updatedAt: new Date(), updatedBy: session.id } });
            if (productUpdated.count !== 1) throw new Error("El stock global cambió mientras se reservaba el repuesto");
          } else {
            if (allocation.reservedQuantity < qty) throw new Error(`Reserva insuficiente. Reservado: ${allocation.reservedQuantity.toString()}`);
            const updated = await tx.stockAllocation.updateMany({ where: { id: allocation.id, reservedQuantity: { gte: qty } }, data: { reservedQuantity: { decrement: qty }, updatedAt: new Date() } });
            if (updated.count !== 1) throw new Error("La reserva cambió mientras se liberaba el repuesto");
            const productUpdated = await tx.product.updateMany({ where: { id: productId, userId: session.id, reservedQuantity: { gte: qty } }, data: { reservedQuantity: { decrement: qty }, updatedAt: new Date(), updatedBy: session.id } });
            if (productUpdated.count !== 1) throw new Error("La reserva global cambió mientras se liberaba el repuesto");
          }
        });
      } catch (error: any) {
        if (typeof error?.message === "string" && (error.message.startsWith("Stock disponible") || error.message.startsWith("Reserva insuficiente") || error.message.startsWith("No existe") || error.message.includes("cambió"))) return jsonError(error.message, 409);
        throw error;
      }
      const current = meta(order.accessories);
      const reservations = { ...(current.partReservations ?? {}) };
      const key = `${productId}:${warehouseId}`;
      const previous = Number(reservations[key]?.quantity ?? 0);
      const next = action === "reserve_part" ? previous + quantity : Math.max(0, previous - quantity);
      if (next === 0) delete reservations[key]; else reservations[key] = { productId, warehouseId, warehouseName: warehouse.name, quantity: next, updatedAt: new Date().toISOString() };
      await prisma.serviceOrder.update({ where: { id }, data: { accessories: withHistory({ ...current, partReservations: reservations }, { type: action, productId, warehouseId, quantity, by: session.id }), updatedAt: new Date(), updatedBy: session.id } });
      await writeAuditLog({ userId: session.id, action: action === "reserve_part" ? "SERVICE_PART_RESERVED" : "SERVICE_PART_RESERVATION_RELEASED", entityType: "ServiceOrder", entityId: id, details: { orderNumber: order.orderNumber, productId, warehouseId, quantity } });
      return NextResponse.json({ reservations });
    }

    if (action === "return_part") {
      const partId = typeof body.partId === "string" ? body.partId.trim() : "";
      const item = order.items.find(i => i.id === partId);
      if (!item?.productId || !item.inventoryApplied || !item.warehouseId) return jsonError("El repuesto no está consumido o no tiene bodega asociada");
      const product = await prisma.product.findFirst({ where: { id: item.productId, userId: session.id, deletedAt: null } });
      if (!product) return jsonError("Producto no encontrado", 404);
      const qty = BigInt(item.quantity);
      const current = meta(order.accessories);
      const returned = Array.isArray(current.returnedParts) ? current.returnedParts : [];
      if (returned.some((entry: any) => entry.partId === partId)) return jsonError("Este repuesto ya fue devuelto", 409);
      await prisma.$transaction(async tx => {
        const allocation = await tx.stockAllocation.findFirst({ where: { productId: item.productId!, warehouseId: item.warehouseId!, userId: session.id } });
        if (!allocation) throw new Error("No existe stock asignado en la bodega del repuesto");
        await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: { increment: qty }, updatedAt: new Date() } });
        const updated = await tx.product.updateMany({ where: { id: product.id, userId: session.id, deletedAt: null }, data: { quantity: { increment: qty }, updatedAt: new Date(), updatedBy: session.id } });
        if (updated.count !== 1) throw new Error("No se pudo restaurar el stock global");
        await tx.serviceOrderItem.update({ where: { id: partId }, data: { inventoryApplied: false } });
        await tx.inventoryMovement.create({ data: { productId: product.id, warehouseId: item.warehouseId!, userId: session.id, type: "entry", quantity: qty, previousStock: product.quantity, newStock: product.quantity + qty, reason: "service_order_return", referenceId: id, notes: order.orderNumber } });
      });
      returned.push({ partId, productId: item.productId, quantity: item.quantity, warehouseId: item.warehouseId, at: new Date().toISOString(), by: session.id });
      await prisma.serviceOrder.update({ where: { id }, data: { accessories: withHistory({ ...current, returnedParts: returned }, { type: "part_return", partId, by: session.id }), updatedAt: new Date(), updatedBy: session.id } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_PART_RETURNED", entityType: "ServiceOrder", entityId: id, details: { orderNumber: order.orderNumber, partId, productId: item.productId, quantity: item.quantity } });
      return NextResponse.json({ returnedParts: returned });
    }

    if (action === "waiting_part") {
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "Repuesto pendiente";
      const current = meta(order.accessories);
      const saved = await prisma.serviceOrder.update({ where: { id }, data: { status: "awaiting_part", notes: reason, accessories: withHistory({ ...current, waitingPart: { active: true, reason, at: new Date().toISOString(), by: session.id } }, { type: "waiting_part", by: session.id }), updatedAt: new Date(), updatedBy: session.id } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_WAITING_PART", entityType: "ServiceOrder", entityId: id, details: { orderNumber: order.orderNumber, reason } });
      return NextResponse.json({ id: saved.id, status: saved.status, notes: saved.notes });
    }

    if (action === "waiting_payment") {
      if (order.amountDue <= 0) return jsonError("La orden no tiene saldo pendiente");
      const current = meta(order.accessories);
      const saved = await prisma.serviceOrder.update({ where: { id }, data: { status: "awaiting_payment", accessories: withHistory({ ...current, waitingPayment: { active: true, amountDue: order.amountDue, at: new Date().toISOString(), by: session.id } }, { type: "waiting_payment", by: session.id }), updatedAt: new Date(), updatedBy: session.id } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_WAITING_PAYMENT", entityType: "ServiceOrder", entityId: id, details: { orderNumber: order.orderNumber, amountDue: order.amountDue } });
      return NextResponse.json({ id: saved.id, status: saved.status, amountDue: saved.amountDue });
    }

    if (action === "notify_customer") {
      const channel = typeof body.channel === "string" ? body.channel.trim().toLowerCase() : "internal";
      const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "Tu orden de servicio tiene una actualización disponible.";
      if (!message) return jsonError("Mensaje obligatorio");
      const current = meta(order.accessories);
      const notifications = Array.isArray(current.customerNotifications) ? current.customerNotifications : [];
      const notification = { channel, message, at: new Date().toISOString(), by: session.id, status: "recorded" };
      notifications.push(notification);
      await prisma.serviceOrder.update({ where: { id }, data: { accessories: withHistory({ ...current, customerNotifications: notifications.slice(-50) }, { type: "customer_notification", channel, by: session.id }), updatedAt: new Date(), updatedBy: session.id } });
      await prisma.notification.create({ data: { userId: session.id, type: "service_order_customer_notification", title: `Notificación ${order.orderNumber}`, message: `Se registró una notificación al cliente por ${channel}.`, link: `/service-orders`, metadata: { orderId: id, channel } } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_CUSTOMER_NOTIFICATION_RECORDED", entityType: "ServiceOrder", entityId: id, details: { orderNumber: order.orderNumber, channel, messageLength: message.length } });
      return NextResponse.json({ notification });
    }

    if (action === "record_actual_cost") {
      const laborCost = Number(body.laborCost);
      if (!Number.isFinite(laborCost) || laborCost < 0) return jsonError("Costo de mano de obra inválido");
      const partsCost = order.items.reduce((sum, item) => sum + Number(item.unitCost) * item.quantity, 0);
      const actualCost = partsCost + laborCost;
      const margin = Number(order.total) - actualCost;
      const current = meta(order.accessories);
      const profitability = { partsCost, laborCost, actualCost, revenue: Number(order.total), margin, marginPercent: Number(order.total) > 0 ? (margin / Number(order.total)) * 100 : 0, calculatedAt: new Date().toISOString(), by: session.id };
      await prisma.serviceOrder.update({ where: { id }, data: { accessories: withHistory({ ...current, actualCost: profitability }, { type: "actual_cost", by: session.id }), updatedAt: new Date(), updatedBy: session.id } });
      await writeAuditLog({ userId: session.id, action: "SERVICE_ACTUAL_COST_RECORDED", entityType: "ServiceOrder", entityId: id, details: { orderNumber: order.orderNumber, ...profitability } });
      return NextResponse.json({ profitability });
    }

    return jsonError("Acción no soportada");
  } catch (error: any) {
    console.error("PUT /api/service-orders/pro", error);
    return NextResponse.json({ error: error?.message || "No se pudo procesar la operación" }, { status: 500 });
  }
}
