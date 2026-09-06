import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";
import { scheduleInvalidateProductCaches, scheduleInvalidateStockAllocationCaches } from "@/lib/cache";
import { validObjectId } from "@/lib/finance/financial-ledger";

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
        const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: purchase.warehouseId! } } });
        const previousProduct = await tx.product.findUnique({ where: { id: item.productId }, select: { quantity: true } });
        if (!previousProduct) throw new Error(`Producto no encontrado: ${item.productName}`);
        if (action === "receive") {
          const pending = item.orderedQuantity - item.receivedQuantity;
          if (q > pending) throw new Error(`No puedes recibir más de lo pendiente para ${item.productName}`);
          const previousAllocation = allocation ? Number(allocation.quantity) : 0;
          if (allocation) await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: BigInt(previousAllocation + q), updatedAt: now } });
          else await tx.stockAllocation.create({ data: { productId: item.productId, warehouseId: purchase.warehouseId!, quantity: BigInt(q), reservedQuantity: 0n, userId: session.id, createdAt: now, updatedAt: now } });
          const allocations = await tx.stockAllocation.findMany({ where: { productId: item.productId }, select: { quantity: true } });
          const newStock = allocations.reduce((sum, a) => sum + Number(a.quantity), 0);
          await tx.product.update({ where: { id: item.productId }, data: { quantity: BigInt(newStock), purchasePrice: item.unitCost, updatedBy: session.id, updatedAt: now } });
          await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: item.receivedQuantity + q } });
          await tx.inventoryMovement.create({ data: { productId: item.productId, warehouseId: purchase.warehouseId!, userId: session.id, type: "purchase_receipt", quantity: BigInt(q), previousStock: previousProduct.quantity, newStock: BigInt(newStock), reason: "Recepción de compra", referenceId: purchase.id, notes: `Compra ${purchase.purchaseNumber}`, createdAt: now } });
        } else {
          const returnable = item.receivedQuantity - item.returnedQuantity;
          if (q > returnable) throw new Error(`No puedes devolver más de lo recibido para ${item.productName}`);
          const previousAllocation = allocation ? Number(allocation.quantity) : 0;
          if (previousAllocation < q) throw new Error(`Stock insuficiente para devolver ${item.productName}`);
          const nextAllocation = previousAllocation - q;
          if (allocation && nextAllocation === 0) await tx.stockAllocation.delete({ where: { id: allocation.id } });
          else if (allocation) await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: BigInt(nextAllocation), updatedAt: now } });
          const allocations = await tx.stockAllocation.findMany({ where: { productId: item.productId }, select: { quantity: true } });
          const newStock = allocations.reduce((sum, a) => sum + Number(a.quantity), 0);
          await tx.product.update({ where: { id: item.productId }, data: { quantity: BigInt(newStock), updatedBy: session.id, updatedAt: now } });
          await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { returnedQuantity: item.returnedQuantity + q } });
          await tx.inventoryMovement.create({ data: { productId: item.productId, warehouseId: purchase.warehouseId!, userId: session.id, type: "purchase_return", quantity: BigInt(-q), previousStock: previousProduct.quantity, newStock: BigInt(newStock), reason: "Devolución a proveedor", referenceId: purchase.id, notes: `Compra ${purchase.purchaseNumber}`, createdAt: now } });
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
