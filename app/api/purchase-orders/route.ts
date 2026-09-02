import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/prisma/client";
import { upsertPurchasePayable } from "@/lib/finance/supplier-payables";

const n = (v: unknown) => Number(v ?? 0);
const finiteNonNegative = (v: unknown) => {
  const value = n(v);
  return Number.isFinite(value) && value >= 0 ? value : null;
};
const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
const CLOSED_STATUSES = ["received", "cancelled"];
const RECEIVABLE_STATUSES = ["draft", "partial"];

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const orders = await prisma.purchaseOrder.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });
  return NextResponse.json(orders);
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await request.json();
    if (!validId(body.supplierId) || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Proveedor y al menos un producto son obligatorios" }, { status: 400 });
    }

    const supplier = await prisma.supplier.findFirst({ where: { id: body.supplierId, userId: session.id, status: true } });
    if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado o inactivo" }, { status: 404 });

    const productIds = body.items.map((i: any) => i?.productId).filter((id: unknown): id is string => validId(id));
    if (productIds.length !== body.items.length || new Set(productIds).size !== productIds.length) {
      return NextResponse.json({ error: "Cada producto debe ser válido y no puede repetirse en la orden" }, { status: 400 });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, userId: session.id, deletedAt: null },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    if (byId.size !== productIds.length) return NextResponse.json({ error: "Uno o más productos no existen o fueron eliminados" }, { status: 400 });

    const items: Array<{
      productId: string;
      productName: string;
      sku: string | null;
      orderedQuantity: number;
      receivedQuantity: number;
      unitCost: number;
      subtotal: number;
    }> = [];

    for (const item of body.items) {
      const p = byId.get(item.productId)!;
      const quantity = finiteNonNegative(item.quantity);
      const unitCost = finiteNonNegative(item.unitCost);
      if (quantity === null || !Number.isInteger(quantity) || quantity < 1) {
        return NextResponse.json({ error: `Cantidad inválida para el producto: ${p.name}` }, { status: 400 });
      }
      if (unitCost === null) {
        return NextResponse.json({ error: `Costo unitario inválido para el producto: ${p.name}` }, { status: 400 });
      }
      items.push({
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        orderedQuantity: quantity,
        receivedQuantity: 0,
        unitCost,
        subtotal: quantity * unitCost,
      });
    }

    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const shipping = finiteNonNegative(body.shipping);
    const tax = finiteNonNegative(body.tax);
    if (shipping === null || tax === null) {
      return NextResponse.json({ error: "Envío e impuestos deben ser valores numéricos válidos" }, { status: 400 });
    }

    const total = subtotal + shipping + tax;
    const purchaseNumber = `OC-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`;
    const order = await prisma.purchaseOrder.create({
      data: {
        purchaseNumber,
        supplierId: supplier.id,
        userId: session.id,
        status: "draft",
        subtotal,
        shipping,
        tax,
        total,
        notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
        createdBy: session.id,
        items: { create: items },
      },
      include: { items: true },
    });

    await writeAuditLog({
      userId: session.id,
      action: "PURCHASE_ORDER_CREATED",
      entityType: "PurchaseOrder",
      entityId: order.id,
      details: { purchaseNumber, supplierId: supplier.id, itemCount: items.length, total },
    });

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("POST /api/purchase-orders", error);
    return NextResponse.json({ error: "No se pudo crear la orden de compra" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await request.json();
    if (!validId(body.id)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });

    const order = await prisma.purchaseOrder.findFirst({
      where: { id: body.id, userId: session.id },
      include: { items: true },
    });
    if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

    if (CLOSED_STATUSES.includes(order.status)) {
      return NextResponse.json({ error: "La orden ya está cerrada y no admite más operaciones" }, { status: 409 });
    }

    if (body.status === "cancelled") {
      if (order.status !== "draft") {
        return NextResponse.json({ error: "No se puede cancelar una orden que ya tiene mercancía recibida. Gestiona una devolución del inventario recibido." }, { status: 409 });
      }

      const updated = await prisma.purchaseOrder.update({
        where: { id: order.id },
        data: { status: "cancelled", updatedAt: new Date(), updatedBy: session.id },
        include: { items: true },
      });
      await writeAuditLog({
        userId: session.id,
        action: "PURCHASE_ORDER_CANCELLED",
        entityType: "PurchaseOrder",
        entityId: order.id,
        details: { purchaseNumber: order.purchaseNumber },
      });
      return NextResponse.json(updated);
    }

    if (body.status !== "received") {
      return NextResponse.json({ error: "Solo se puede marcar una orden como recibida" }, { status: 400 });
    }
    if (!RECEIVABLE_STATUSES.includes(order.status)) {
      return NextResponse.json({ error: "La orden no está disponible para recepción" }, { status: 409 });
    }

    const requested = Array.isArray(body.items)
      ? body.items
      : order.items.map((item) => ({ id: item.id, quantity: item.orderedQuantity - item.receivedQuantity }));

    const receivedMap = new Map<string, number>();
    for (const item of requested) {
      if (!validId(item?.id)) return NextResponse.json({ error: "Hay una línea de recepción inválida" }, { status: 400 });
      const quantity = n(item.quantity);
      if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 0) {
        return NextResponse.json({ error: "Las cantidades recibidas deben ser enteros no negativos" }, { status: 400 });
      }
      receivedMap.set(String(item.id), quantity);
    }

    const warehouseId = typeof body.warehouseId === "string" ? body.warehouseId : "";
    if (!validId(warehouseId)) return NextResponse.json({ error: "Selecciona una bodega válida" }, { status: 400 });

    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, userId: session.id, status: true },
      select: { id: true, name: true },
    });
    if (!warehouse) return NextResponse.json({ error: "Bodega no encontrada o inactiva" }, { status: 404 });

    let receivedUnits = 0;
    const result = await prisma.$transaction(async (tx) => {
      let allReceived = true;
      let changed = false;

      for (const item of order.items) {
        const remaining = Math.max(0, item.orderedQuantity - item.receivedQuantity);
        const requestedQty = Math.max(0, Math.floor(receivedMap.get(item.id) ?? 0));
        const qty = Math.min(remaining, requestedQty);
        if (requestedQty > remaining) {
          throw new Error(`La recepción de ${item.productName} supera la cantidad pendiente`);
        }
        if (qty <= 0) {
          if (remaining > 0) allReceived = false;
          continue;
        }
        changed = true;
        receivedUnits += qty;

        const product = await tx.product.findFirst({ where: { id: item.productId, userId: session.id, deletedAt: null } });
        if (!product) throw new Error(`Producto no encontrado: ${item.productName}`);

        const oldGlobalQty = n(product.quantity);
        const oldCost = n(product.purchasePrice);
        const newGlobalQty = oldGlobalQty + qty;
        const weightedCost = newGlobalQty > 0
          ? ((oldGlobalQty * oldCost) + (qty * item.unitCost)) / newGlobalQty
          : item.unitCost;

        const allocation = await tx.stockAllocation.findUnique({
          where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        });
        const previousWarehouseStock = allocation?.quantity ?? 0n;
        const newWarehouseStock = previousWarehouseStock + BigInt(qty);

        if (allocation) {
          await tx.stockAllocation.update({
            where: { id: allocation.id },
            data: { quantity: newWarehouseStock, updatedAt: new Date() },
          });
        } else {
          await tx.stockAllocation.create({
            data: {
              productId: product.id,
              warehouseId: warehouse.id,
              userId: session.id,
              quantity: newWarehouseStock,
              reservedQuantity: 0n,
              createdAt: new Date(),
            },
          });
        }

        const allocations = await tx.stockAllocation.findMany({
          where: { productId: product.id, userId: session.id },
          select: { quantity: true },
        });
        const totalStock = allocations.reduce((sum, row) => sum + row.quantity, 0n);

        await tx.product.update({
          where: { id: product.id },
          data: { quantity: totalStock, purchasePrice: weightedCost, updatedAt: new Date(), updatedBy: session.id },
        });

        const nextReceived = item.receivedQuantity + qty;
        const updatedLine = await tx.purchaseOrderItem.updateMany({
          where: { id: item.id, receivedQuantity: item.receivedQuantity },
          data: { receivedQuantity: nextReceived },
        });
        if (updatedLine.count !== 1) throw new Error("La orden cambió mientras se procesaba. Intenta recibirla nuevamente.");

        await tx.inventoryMovement.create({
          data: {
            productId: product.id,
            warehouseId: warehouse.id,
            userId: session.id,
            type: "entry",
            quantity: BigInt(qty),
            previousStock: previousWarehouseStock,
            newStock: newWarehouseStock,
            reason: "Recepción de compra",
            referenceId: order.id,
            notes: `${order.purchaseNumber} · ${item.productName}`,
          },
        });

        if (nextReceived < item.orderedQuantity) allReceived = false;
      }

      if (!changed) throw new Error("No hay cantidades pendientes para recibir");

      const now = new Date();
      return tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: allReceived ? "received" : "partial",
          orderedAt: order.orderedAt ?? now,
          receivedAt: allReceived ? now : order.receivedAt,
          updatedAt: now,
          updatedBy: session.id,
        },
        include: { items: true },
      });
    });

    let payable;
    try {
      payable = await upsertPurchasePayable({
        userId: session.id,
        supplierId: order.supplierId,
        supplierName: (await prisma.supplier.findUnique({ where: { id: order.supplierId }, select: { name: true } }))?.name ?? "Proveedor",
        purchaseOrderId: result.id,
        purchaseNumber: result.purchaseNumber,
        subtotal: result.subtotal,
        tax: result.tax,
        shipping: result.shipping,
        receivedItems: result.items.map((item) => ({ receivedQuantity: item.receivedQuantity, unitCost: item.unitCost })),
      });
    } catch (payableError) {
      console.error("POST /api/purchase-orders payable sync", payableError);
      return NextResponse.json({ error: "La recepción se realizó, pero no se pudo sincronizar CxP. Reintenta la sincronización financiera antes de continuar." }, { status: 500 });
    }

    await writeAuditLog({
      userId: session.id,
      action: result.status === "received" ? "PURCHASE_ORDER_RECEIVED" : "PURCHASE_ORDER_PARTIALLY_RECEIVED",
      entityType: "PurchaseOrder",
      entityId: result.id,
      details: {
        purchaseNumber: result.purchaseNumber,
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        receivedUnits,
        status: result.status,
        payableId: payable.id,
        payableAmount: payable.originalAmount,
      },
    });

    return NextResponse.json({ ...result, payable });
  } catch (error: any) {
    const message = typeof error?.message === "string" ? error.message : "No se pudo procesar la recepción";
    const expected = [
      "La recepción",
      "Producto no encontrado",
      "La orden cambió mientras se procesaba",
      "No hay cantidades pendientes",
    ].some((prefix) => message.startsWith(prefix));
    if (expected) return NextResponse.json({ error: message }, { status: 409 });
    console.error("PATCH /api/purchase-orders", error);
    return NextResponse.json({ error: "No se pudo procesar la recepción de la orden" }, { status: 500 });
  }
}
