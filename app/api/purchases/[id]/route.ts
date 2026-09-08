import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";
import { financeDb, oid, validObjectId } from "@/lib/finance/financial-ledger";
import { scheduleInvalidateProductCaches, scheduleInvalidateStockAllocationCaches } from "@/lib/cache";

async function calculateProductStock(tx: any, productId: string) {
  const [allocations, variants] = await Promise.all([
    tx.stockAllocation.findMany({ where: { productId }, select: { quantity: true } }),
    tx.productVariant.findMany({ where: { productId }, select: { quantity: true } }),
  ]);
  return allocations.reduce((sum: number, row: any) => sum + Number(row.quantity), 0) + variants.reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(request, "finance", "read");
  if (auth.response) return auth.response;
  const session = auth.session!;
  const { id } = await params;
  if (!validObjectId(id)) return NextResponse.json({ error: "Compra inválida" }, { status: 400 });
  const purchase = await prisma.purchaseOrder.findFirst({ where: { id, userId: session.id }, include: { items: true } });
  if (!purchase) return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
  const [supplier, warehouse] = await Promise.all([
    prisma.supplier.findFirst({ where: { id: purchase.supplierId, userId: session.id }, select: { id: true, name: true } }),
    purchase.warehouseId ? prisma.warehouse.findFirst({ where: { id: purchase.warehouseId, userId: session.id }, select: { id: true, name: true } }) : null,
  ]);
  return NextResponse.json({ ...purchase, subtotal: Number(purchase.subtotal), discount: Number(purchase.discount), tax: Number(purchase.tax), shipping: Number(purchase.shipping), total: Number(purchase.total), supplier, warehouse, items: purchase.items.map(i => ({ ...i, unitCost: Number(i.unitCost), subtotal: Number(i.subtotal) })) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(request, "finance", "manage_expenses");
  if (auth.response) return auth.response;
  const session = auth.session!;
  const { id } = await params;
  if (!validObjectId(id)) return NextResponse.json({ error: "Compra inválida" }, { status: 400 });
  const purchase = await prisma.purchaseOrder.findFirst({ where: { id, userId: session.id }, include: { items: true } });
  if (!purchase) return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
  if (purchase.status === "cancelled") return NextResponse.json({ error: "La compra está anulada y no puede modificarse" }, { status: 400 });
  if (!purchase.warehouseId) return NextResponse.json({ error: "La compra no tiene almacén asignado" }, { status: 400 });
  const body = await request.json();
  const action = body.action;
  if (action !== "receive" && action !== "return") return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  const requested = new Map<string, number>(Array.isArray(body.items) ? body.items.map((x: any) => [String(x.itemId), Math.floor(Number(x.quantity))]) : []);
  const now = new Date();
  try {
    await prisma.$transaction(async tx => {
      for (const item of purchase.items) {
        const q = requested.get(item.id) ?? 0;
        if (!Number.isInteger(q) || q <= 0) continue;
        const previousProduct = await tx.product.findUnique({ where: { id: item.productId }, select: { quantity: true } });
        if (!previousProduct) throw new Error(`Producto no encontrado: ${item.productName}`);
        if (action === "receive") {
          const pending = item.orderedQuantity - item.receivedQuantity;
          if (q > pending) throw new Error(`No puedes recibir más de lo pendiente para ${item.productName}${item.variantName ? ` · ${item.variantName}` : ""}`);
          if (item.variantId) {
            const variant = await tx.productVariant.findFirst({ where: { id: item.variantId, productId: item.productId, userId: session.id } });
            if (!variant) throw new Error(`Variante no encontrada: ${item.variantName ?? item.productName}`);
            const stock = await tx.productVariantStock.findUnique({ where: { variantId_warehouseId: { variantId: variant.id, warehouseId: purchase.warehouseId! } } });
            const previousVariantStock = stock ? Number(stock.quantity) : 0;
            if (stock) await tx.productVariantStock.update({ where: { id: stock.id }, data: { quantity: BigInt(previousVariantStock + q), updatedAt: now } });
            else await tx.productVariantStock.create({ data: { variantId: variant.id, warehouseId: purchase.warehouseId!, quantity: BigInt(q), reservedQuantity: 0n, userId: session.id, createdAt: now, updatedAt: now } });
            const variantStocks = await tx.productVariantStock.findMany({ where: { variantId: variant.id }, select: { quantity: true } });
            const variantStock = variantStocks.reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
            await tx.productVariant.update({ where: { id: variant.id }, data: { quantity: BigInt(variantStock), purchasePrice: item.unitCost, updatedBy: session.id, updatedAt: now } });
          } else {
            const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: purchase.warehouseId! } } });
            const previousAllocation = allocation ? Number(allocation.quantity) : 0;
            if (allocation) await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: BigInt(previousAllocation + q), updatedAt: now } });
            else await tx.stockAllocation.create({ data: { productId: item.productId, warehouseId: purchase.warehouseId!, quantity: BigInt(q), reservedQuantity: 0n, userId: session.id, createdAt: now, updatedAt: now } });
            await tx.product.update({ where: { id: item.productId }, data: { purchasePrice: item.unitCost, updatedBy: session.id, updatedAt: now } });
          }
          const newStock = await calculateProductStock(tx, item.productId);
          await tx.product.update({ where: { id: item.productId }, data: { quantity: BigInt(newStock), updatedBy: session.id, updatedAt: now } });
          await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: item.receivedQuantity + q } });
          await tx.inventoryMovement.create({ data: { productId: item.productId, variantId: item.variantId ?? null, warehouseId: purchase.warehouseId!, userId: session.id, type: "purchase_receipt", quantity: BigInt(q), previousStock: previousProduct.quantity, newStock: BigInt(newStock), reason: "Recepción de compra", referenceId: purchase.id, notes: `Compra ${purchase.purchaseNumber}${item.variantName ? ` · ${item.variantName}` : ""}`, createdAt: now } });
        } else {
          const returnable = item.receivedQuantity - item.returnedQuantity;
          if (q > returnable) throw new Error(`No puedes devolver más de lo recibido para ${item.productName}${item.variantName ? ` · ${item.variantName}` : ""}`);
          if (item.variantId) {
            const stock = await tx.productVariantStock.findUnique({ where: { variantId_warehouseId: { variantId: item.variantId, warehouseId: purchase.warehouseId! } } });
            const previousAllocation = stock ? Number(stock.quantity) : 0;
            if (!stock || previousAllocation < q) throw new Error(`Stock insuficiente para devolver ${item.productName}${item.variantName ? ` · ${item.variantName}` : ""}`);
            const nextAllocation = previousAllocation - q;
            if (nextAllocation === 0) await tx.productVariantStock.delete({ where: { id: stock.id } });
            else await tx.productVariantStock.update({ where: { id: stock.id }, data: { quantity: BigInt(nextAllocation), updatedAt: now } });
            const stocks = await tx.productVariantStock.findMany({ where: { variantId: item.variantId }, select: { quantity: true } });
            const nextVariantStock = stocks.reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
            await tx.productVariant.update({ where: { id: item.variantId }, data: { quantity: BigInt(nextVariantStock), updatedBy: session.id, updatedAt: now } });
          } else {
            const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: purchase.warehouseId! } } });
            const previousAllocation = allocation ? Number(allocation.quantity) : 0;
            if (!allocation || previousAllocation < q) throw new Error(`Stock insuficiente para devolver ${item.productName}`);
            const nextAllocation = previousAllocation - q;
            if (nextAllocation === 0) await tx.stockAllocation.delete({ where: { id: allocation.id } });
            else await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: BigInt(nextAllocation), updatedAt: now } });
          }
          const newStock = await calculateProductStock(tx, item.productId);
          await tx.product.update({ where: { id: item.productId }, data: { quantity: BigInt(newStock), updatedBy: session.id, updatedAt: now } });
          await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { returnedQuantity: item.returnedQuantity + q } });
          await tx.inventoryMovement.create({ data: { productId: item.productId, variantId: item.variantId ?? null, warehouseId: purchase.warehouseId!, userId: session.id, type: "purchase_return", quantity: BigInt(-q), previousStock: previousProduct.quantity, newStock: BigInt(newStock), reason: "Devolución a proveedor", referenceId: purchase.id, notes: `Compra ${purchase.purchaseNumber}${item.variantName ? ` · ${item.variantName}` : ""}`, createdAt: now } });
        }
      }
      const updatedItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: purchase.id } });
      const fullyReceived = updatedItems.every(i => i.receivedQuantity >= i.orderedQuantity);
      const anyReceived = updatedItems.some(i => i.receivedQuantity > 0);
      const allReturned = updatedItems.every(i => i.returnedQuantity >= i.receivedQuantity && i.receivedQuantity > 0);
      await tx.purchaseOrder.update({ where: { id: purchase.id }, data: { status: allReturned ? "returned" : fullyReceived ? "received" : anyReceived ? "partial" : "pending", receivedAt: fullyReceived ? now : purchase.receivedAt, updatedAt: now, updatedBy: session.id } });
    });
    await writeAuditLog({ userId: session.id, action: action === "receive" ? "PURCHASE_RECEIVED" : "PURCHASE_RETURNED", entityType: "PurchaseOrder", entityId: purchase.id, details: { purchaseNumber: purchase.purchaseNumber, items: [...requested.entries()] } });
    await Promise.all([scheduleInvalidateProductCaches(), scheduleInvalidateStockAllocationCaches()]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la compra" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest(request, "finance", "manage_expenses");
  if (auth.response) return auth.response;
  const session = auth.session!;
  const { id } = await params;
  if (!validObjectId(id)) return NextResponse.json({ error: "Compra inválida" }, { status: 400 });
  const purchase = await prisma.purchaseOrder.findFirst({ where: { id, userId: session.id }, include: { items: true } });
  if (!purchase) return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });
  if (purchase.status === "cancelled") return NextResponse.json({ error: "La compra ya está anulada" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (reason.length < 5) return NextResponse.json({ error: "Indica una observación de al menos 5 caracteres para anular la compra" }, { status: 400 });
  const remainingByItem = purchase.items.map(item => ({ item, quantity: Math.max(0, item.receivedQuantity - item.returnedQuantity) })).filter(x => x.quantity > 0);
  const now = new Date();
  try {
    const db = await financeDb();
    const payable = purchase.paymentMode === "credit" ? await db.collection("SupplierAccountPayable").findOne({ userId: oid(session.id), purchaseOrderId: oid(purchase.id) }) : null;
    if (payable && Number(payable.amountPaid ?? 0) > 0.0001) return NextResponse.json({ error: "No puedes anular esta compra porque la cuenta por pagar ya tiene pagos registrados. Primero revierte esos pagos." }, { status: 409 });

    const reversedItems: Array<{ itemId: string; productName: string; requested: number; reversed: number }> = [];
    await prisma.$transaction(async tx => {
      for (const { item, quantity } of remainingByItem) {
        if (!purchase.warehouseId) throw new Error("La compra no tiene almacén asignado");
        const previousProduct = await tx.product.findUnique({ where: { id: item.productId }, select: { quantity: true } });
        if (!previousProduct) {
          reversedItems.push({ itemId: item.id, productName: item.productName, requested: quantity, reversed: 0 });
          continue;
        }
        let reversed = 0;
        if (item.variantId) {
          const stock = await tx.productVariantStock.findUnique({ where: { variantId_warehouseId: { variantId: item.variantId, warehouseId: purchase.warehouseId } } });
          const previous = stock ? Number(stock.quantity) : 0;
          reversed = Math.min(previous, quantity);
          if (stock && reversed > 0) {
            const next = previous - reversed;
            if (next === 0) await tx.productVariantStock.delete({ where: { id: stock.id } });
            else await tx.productVariantStock.update({ where: { id: stock.id }, data: { quantity: BigInt(next), updatedAt: now } });
          }
          const stocks = await tx.productVariantStock.findMany({ where: { variantId: item.variantId }, select: { quantity: true } });
          const variantStock = stocks.reduce((sum: number, row: any) => sum + Number(row.quantity), 0);
          await tx.productVariant.update({ where: { id: item.variantId }, data: { quantity: BigInt(variantStock), updatedBy: session.id, updatedAt: now } });
        } else {
          const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: purchase.warehouseId } } });
          const previous = allocation ? Number(allocation.quantity) : 0;
          reversed = Math.min(previous, quantity);
          if (allocation && reversed > 0) {
            const next = previous - reversed;
            if (next === 0) await tx.stockAllocation.delete({ where: { id: allocation.id } });
            else await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: BigInt(next), updatedAt: now } });
          }
        }
        const newStock = await calculateProductStock(tx, item.productId);
        await tx.product.update({ where: { id: item.productId }, data: { quantity: BigInt(newStock), updatedBy: session.id, updatedAt: now } });
        if (reversed > 0) {
          await tx.inventoryMovement.create({ data: { productId: item.productId, variantId: item.variantId ?? null, warehouseId: purchase.warehouseId, userId: session.id, type: "purchase_void", quantity: BigInt(-reversed), previousStock: previousProduct.quantity, newStock: BigInt(newStock), reason: "Anulación de compra", referenceId: purchase.id, notes: `${purchase.purchaseNumber} · ${reason}` + (reversed < quantity ? ` · Se revirtieron ${reversed} de ${quantity} unidades disponibles` : ""), createdAt: now } });
        }
        reversedItems.push({ itemId: item.id, productName: item.productName, requested: quantity, reversed });
      }
      await tx.purchaseOrder.update({ where: { id: purchase.id }, data: { status: "cancelled", updatedAt: now, updatedBy: session.id, notes: purchase.notes ? `${purchase.notes}\nAnulada: ${reason}`.slice(0, 500) : `Anulada: ${reason}` } });
    });

    const expense = await db.collection("Expense").findOne({ userId: oid(session.id), purchaseOrderId: oid(purchase.id) });
    if (expense) await db.collection("Expense").updateOne({ _id: expense._id, userId: oid(session.id) }, { $set: { status: "voided", voidedAt: now, voidedBy: oid(session.id), voidReason: reason, updatedAt: now } });
    if (purchase.paymentMode === "paid") {
      await prisma.cashMovement.updateMany({ where: { userId: session.id, source: "purchase", type: "expense", status: "active", description: { contains: `Compra ${purchase.purchaseNumber}` } }, data: { status: "voided", voidedAt: now, voidedBy: session.id, voidReason: reason } });
    } else if (payable) {
      await db.collection("SupplierAccountPayable").updateOne({ _id: payable._id, userId: oid(session.id) }, { $set: { status: "voided", amountDue: 0, voidedAt: now, voidedBy: oid(session.id), voidReason: reason, updatedAt: now } });
    }
    await writeAuditLog({ userId: session.id, action: "PURCHASE_VOIDED", entityType: "PurchaseOrder", entityId: purchase.id, details: { purchaseNumber: purchase.purchaseNumber, reason, reversedItems, paymentMode: purchase.paymentMode } });
    await Promise.all([scheduleInvalidateProductCaches(), scheduleInvalidateStockAllocationCaches()]);
    return NextResponse.json({ success: true, status: "cancelled", reversedItems });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo anular la compra" }, { status: 400 });
  }
}
