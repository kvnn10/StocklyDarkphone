import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";
import { financeDb, jsonSafe, nextDocumentNumber, oid, validObjectId } from "@/lib/finance/financial-ledger";
import { upsertPurchasePayable } from "@/lib/finance/supplier-payables";
import { scheduleInvalidateProductCaches, scheduleInvalidateStockAllocationCaches } from "@/lib/cache";
import { mergeProductListWhere } from "@/lib/products/product-query";

const METHODS = ["cash", "card", "transfer", "other"] as const;
const PAYMENT_MODES = ["paid", "credit"] as const;

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, "finance", "read");
  if (auth.response) return auth.response;
  const session = auth.session!;
  const rows = await prisma.purchaseOrder.findMany({
    where: { userId: session.id },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const supplierIds = [...new Set(rows.map((row) => row.supplierId))];
  const suppliers = supplierIds.length ? await prisma.supplier.findMany({ where: { id: { in: supplierIds }, userId: session.id }, select: { id: true, name: true } }) : [];
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  const db = await financeDb();
  const payables = rows.length ? await db.collection("SupplierAccountPayable").find({ userId: oid(session.id), purchaseOrderId: { $in: rows.map((row) => oid(row.id)) } }).toArray() : [];
  const payableMap = new Map(payables.map((row: any) => [row.purchaseOrderId?.toHexString?.(), jsonSafe(row)]));
  return NextResponse.json(rows.map((row) => ({ ...row, subtotal: Number(row.subtotal), tax: Number(row.tax), shipping: Number(row.shipping), total: Number(row.total), supplierName: supplierMap.get(row.supplierId) ?? "Proveedor", payable: payableMap.get(row.id) ?? null, items: row.items.map((item) => ({ ...item, unitCost: Number(item.unitCost), subtotal: Number(item.subtotal) })) })));
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, "finance", "manage_expenses");
  if (auth.response) return auth.response;
  const session = auth.session!;
  try {
    const body = await request.json();
    if (!validObjectId(body.supplierId) || !validObjectId(body.warehouseId)) return NextResponse.json({ error: "Proveedor o almacén inválido" }, { status: 400 });
    const supplier = await prisma.supplier.findFirst({ where: { id: body.supplierId, userId: session.id, status: true } });
    const warehouse = await prisma.warehouse.findFirst({ where: { id: body.warehouseId, userId: session.id, status: true } });
    if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado o inactivo" }, { status: 404 });
    if (!warehouse) return NextResponse.json({ error: "Almacén no encontrado o inactivo" }, { status: 404 });
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) return NextResponse.json({ error: "La compra debe tener al menos un producto" }, { status: 400 });
    const items = rawItems.map((item: any) => ({ productId: String(item.productId ?? ""), quantity: Math.floor(Number(item.quantity)), unitCost: Number(item.unitCost) })).filter((item: any) => item.productId && Number.isInteger(item.quantity) && item.quantity > 0 && Number.isFinite(item.unitCost) && item.unitCost >= 0);
    if (items.length !== rawItems.length) return NextResponse.json({ error: "Hay productos con cantidad o costo inválido" }, { status: 400 });
    const ids = [...new Set(items.map((item: any) => item.productId))];
    if (ids.length !== items.length) return NextResponse.json({ error: "No repitas el mismo producto; ajusta su cantidad" }, { status: 400 });
    const products = await prisma.product.findMany({ where: mergeProductListWhere({ userId: session.id, id: { in: ids } }), select: { id: true, name: true, sku: true, quantity: true, purchasePrice: true } });
    if (products.length !== ids.length) return NextResponse.json({ error: "Uno o más productos no existen o no pertenecen a tu inventario" }, { status: 404 });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const subtotal = items.reduce((sum: number, item: any) => sum + item.quantity * item.unitCost, 0);
    const tax = Math.max(0, Number(body.tax) || 0);
    const shipping = Math.max(0, Number(body.shipping) || 0);
    const total = Math.round((subtotal + tax + shipping + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(total) || total <= 0) return NextResponse.json({ error: "El total de la compra debe ser mayor que cero" }, { status: 400 });
    const paymentMode = PAYMENT_MODES.includes(body.paymentMode) ? body.paymentMode : "paid";
    const paymentMethod = METHODS.includes(body.paymentMethod) ? body.paymentMethod : "cash";
    const now = new Date();
    const purchaseNumber = await nextDocumentNumber("COMP", "PurchaseOrder", "purchaseNumber");
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : null;
    const purchase = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({ data: { purchaseNumber, supplierId: supplier.id, userId: session.id, status: "received", subtotal, tax, shipping, total, notes, orderedAt: now, receivedAt: now, createdAt: now, createdBy: session.id, items: { create: items.map((item: any) => { const product = productMap.get(item.productId)!; return { productId: product.id, productName: product.name, sku: product.sku, orderedQuantity: item.quantity, receivedQuantity: item.quantity, unitCost: item.unitCost, subtotal: item.quantity * item.unitCost }; }) } } });
      for (const item of items) {
        const product = productMap.get(item.productId)!;
        const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } } });
        const previousAllocation = allocation ? Number(allocation.quantity) : 0;
        const previousProductStock = Number(product.quantity);
        if (allocation) await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: BigInt(previousAllocation + item.quantity), updatedAt: now } });
        else await tx.stockAllocation.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: BigInt(item.quantity), reservedQuantity: 0n, userId: session.id, createdAt: now, updatedAt: now } });
        const allocations = await tx.stockAllocation.findMany({ where: { productId: product.id }, select: { quantity: true } });
        const newProductStock = allocations.reduce((sum, row) => sum + Number(row.quantity), 0);
        await tx.product.update({ where: { id: product.id }, data: { quantity: BigInt(newProductStock), purchasePrice: item.unitCost, updatedBy: session.id, updatedAt: now } });
        await tx.inventoryMovement.create({ data: { productId: product.id, warehouseId: warehouse.id, userId: session.id, type: "purchase", quantity: BigInt(item.quantity), previousStock: BigInt(previousProductStock), newStock: BigInt(newProductStock), reason: "Compra de inventario", referenceId: created.id, notes: `Compra ${purchaseNumber}`, createdAt: now } });
      }
      return created;
    });

    const db = await financeDb();
    const expenseNumber = await nextDocumentNumber("EXP", "Expense", "expenseNumber");
    const expense = { expenseNumber, userId: oid(session.id), amount: total, description: `Compra ${purchaseNumber} · ${supplier.name}`, category: "Compra de inventario", paymentMethod: paymentMode === "paid" ? paymentMethod : "other", paymentStatus: paymentMode === "paid" ? "paid" : "pending", paymentTerms: paymentMode === "credit" ? "credit" : "immediate", purchaseOrderId: oid(purchase.id), supplierId: oid(supplier.id), status: "active", createdBy: oid(session.id), createdAt: now };
    const expenseResult = await db.collection("Expense").insertOne(expense);
    let cashMovementId: string | null = null;
    let payable: any = null;
    try {
      if (paymentMode === "paid") {
        const movement = await prisma.cashMovement.create({ data: { type: "expense", source: "purchase", amount: total, paymentMethod, userId: session.id, createdBy: session.id, description: `Compra ${purchaseNumber} · ${supplier.name}`, status: "active", createdAt: now } });
        cashMovementId = movement.id;
      } else {
        payable = await upsertPurchasePayable({ userId: session.id, supplierId: supplier.id, supplierName: supplier.name, purchaseOrderId: purchase.id, purchaseNumber, subtotal, tax, shipping, receivedItems: items.map((item: any) => ({ receivedQuantity: item.quantity, unitCost: item.unitCost })), dueDate: body.dueDate ? new Date(body.dueDate) : now, now });
      }
    } catch (financeError) {
      await db.collection("Expense").deleteOne({ _id: expenseResult.insertedId });
      await prisma.$transaction(async (tx) => {
        for (const item of items) {
          const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: item.productId, warehouseId: warehouse.id } } });
          if (allocation) {
            const next = Number(allocation.quantity) - item.quantity;
            if (next <= 0) await tx.stockAllocation.delete({ where: { id: allocation.id } });
            else await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: BigInt(next), updatedAt: new Date() } });
          }
          const allocations = await tx.stockAllocation.findMany({ where: { productId: item.productId }, select: { quantity: true } });
          await tx.product.update({ where: { id: item.productId }, data: { quantity: BigInt(allocations.reduce((sum, row) => sum + Number(row.quantity), 0)), updatedAt: new Date() } });
          await tx.inventoryMovement.deleteMany({ where: { referenceId: purchase.id, productId: item.productId } });
        }
        await tx.purchaseOrder.delete({ where: { id: purchase.id } });
      });
      throw financeError;
    }
    await writeAuditLog({ userId: session.id, action: "PURCHASE_CREATED", entityType: "PurchaseOrder", entityId: purchase.id, details: { purchaseNumber, supplierId: supplier.id, total, paymentMode, paymentMethod, warehouseId: warehouse.id, expenseId: expenseResult.insertedId.toHexString(), cashMovementId, payableId: payable?.id ?? null } });
    await Promise.all([scheduleInvalidateProductCaches(), scheduleInvalidateStockAllocationCaches()]);
    return NextResponse.json({ id: purchase.id, purchaseNumber, total, paymentMode, paymentMethod, cashMovementId, payable, expenseId: expenseResult.insertedId.toHexString() }, { status: 201 });
  } catch (error) {
    console.error("POST /api/purchases", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo registrar la compra" }, { status: 500 });
  }
}
