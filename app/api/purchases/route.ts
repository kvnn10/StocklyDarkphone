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
  const rows = await prisma.purchaseOrder.findMany({ where: { userId: session.id }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 200 });
  const supplierIds = [...new Set(rows.map(r => r.supplierId))];
  const suppliers = supplierIds.length ? await prisma.supplier.findMany({ where: { id: { in: supplierIds }, userId: session.id }, select: { id: true, name: true } }) : [];
  const warehouses = [...new Set(rows.map(r => r.warehouseId).filter(Boolean) as string[])];
  const warehouseRows = warehouses.length ? await prisma.warehouse.findMany({ where: { id: { in: warehouses }, userId: session.id }, select: { id: true, name: true } }) : [];
  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  const warehouseMap = new Map(warehouseRows.map(w => [w.id, w.name]));
  const db = await financeDb();
  const payables = rows.length ? await db.collection("SupplierAccountPayable").find({ userId: oid(session.id), purchaseOrderId: { $in: rows.map(r => oid(r.id)) } }).toArray() : [];
  const payableMap = new Map(payables.map((r: any) => [r.purchaseOrderId?.toHexString?.(), jsonSafe(r)]));
  return NextResponse.json(rows.map(row => ({ ...row, subtotal: Number(row.subtotal), discount: Number(row.discount), tax: Number(row.tax), shipping: Number(row.shipping), total: Number(row.total), supplierName: supplierMap.get(row.supplierId) ?? "Proveedor", warehouseName: row.warehouseId ? warehouseMap.get(row.warehouseId) ?? "Almacén" : "—", payable: payableMap.get(row.id) ?? null, items: row.items.map(i => ({ ...i, unitCost: Number(i.unitCost), subtotal: Number(i.subtotal) })) })));
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, "finance", "manage_expenses");
  if (auth.response) return auth.response;
  const session = auth.session!;
  try {
    const body = await request.json();
    if (!validObjectId(body.supplierId) || !validObjectId(body.warehouseId)) return NextResponse.json({ error: "Proveedor o almacén inválido" }, { status: 400 });
    const [supplier, warehouse] = await Promise.all([
      prisma.supplier.findFirst({ where: { id: body.supplierId, userId: session.id, status: true } }),
      prisma.warehouse.findFirst({ where: { id: body.warehouseId, userId: session.id, status: true } }),
    ]);
    if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado o inactivo" }, { status: 404 });
    if (!warehouse) return NextResponse.json({ error: "Almacén no encontrado o inactivo" }, { status: 404 });
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) return NextResponse.json({ error: "La compra debe tener al menos un producto" }, { status: 400 });
    const items = rawItems.map((item: any) => ({ productId: String(item.productId ?? ""), variantId: item.variantId ? String(item.variantId) : null, quantity: Math.floor(Number(item.quantity)), receivedQuantity: item.receivedQuantity === undefined ? Math.floor(Number(item.quantity)) : Math.floor(Number(item.receivedQuantity)), unitCost: Number(item.unitCost) })).filter((i: any) => i.productId && (!i.variantId || validObjectId(i.variantId)) && Number.isInteger(i.quantity) && i.quantity > 0 && Number.isInteger(i.receivedQuantity) && i.receivedQuantity >= 0 && i.receivedQuantity <= i.quantity && Number.isFinite(i.unitCost) && i.unitCost >= 0);
    if (items.length !== rawItems.length) return NextResponse.json({ error: "Hay productos con variante, cantidad, recepción o costo inválido" }, { status: 400 });
    const keys = items.map((i: any) => `${i.productId}:${i.variantId ?? "base"}`);
    if (new Set(keys).size !== keys.length) return NextResponse.json({ error: "No repitas la misma combinación de producto y variante" }, { status: 400 });
    const ids: string[] = Array.from(new Set<string>(items.map((i: any) => i.productId)));
    const products = await prisma.product.findMany({ where: mergeProductListWhere({ userId: session.id, id: { in: ids } }), select: { id: true, name: true, sku: true, quantity: true, purchasePrice: true } });
    if (products.length !== ids.length) return NextResponse.json({ error: "Uno o más productos no existen o no pertenecen a tu inventario" }, { status: 404 });
    const productMap = new Map(products.map(p => [p.id, p]));
    const productVariantRows = await prisma.productVariant.findMany({ where: { productId: { in: ids }, userId: session.id }, select: { id: true, productId: true, name: true, sku: true, price: true, purchasePrice: true, quantity: true } });
    const variantProductIds = new Set(productVariantRows.map(v => v.productId));
    for (const item of items) if (variantProductIds.has(item.productId) && !item.variantId) return NextResponse.json({ error: `Selecciona una variante para ${productMap.get(item.productId)?.name ?? "el producto"}` }, { status: 400 });
    const variantIds = items.filter((i: any) => i.variantId).map((i: any) => i.variantId) as string[];
    if (variantIds.some(id => !productVariantRows.some(v => v.id === id))) return NextResponse.json({ error: "Una o más variantes no existen o no pertenecen a tu inventario" }, { status: 404 });
    const variants = productVariantRows.filter(v => variantIds.includes(v.id));
    const variantMap = new Map(variants.map(v => [v.id, v]));
    for (const item of items) if (item.variantId && variantMap.get(item.variantId)?.productId !== item.productId) return NextResponse.json({ error: "La variante no pertenece al producto seleccionado" }, { status: 400 });
    const subtotal = items.reduce((sum: number, i: any) => sum + i.quantity * i.unitCost, 0);
    const discount = Math.min(subtotal, Math.max(0, Number(body.discount) || 0));
    const tax = Math.max(0, Number(body.tax) || 0);
    const shipping = Math.max(0, Number(body.shipping) || 0);
    const total = Math.round((subtotal - discount + tax + shipping + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(total) || total <= 0) return NextResponse.json({ error: "El total de la compra debe ser mayor que cero" }, { status: 400 });
    const paymentMode = PAYMENT_MODES.includes(body.paymentMode) ? body.paymentMode : "paid";
    const paymentMethod = METHODS.includes(body.paymentMethod) ? body.paymentMethod : "cash";
    const now = new Date();
    const purchaseNumber = await nextDocumentNumber("COMP", "PurchaseOrder", "purchaseNumber");
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : null;
    const supplierInvoice = typeof body.supplierInvoice === "string" ? body.supplierInvoice.trim().slice(0, 100) : null;
    const dueDate = body.dueDate ? new Date(body.dueDate) : null;
    const allReceived = items.every((i: any) => i.receivedQuantity === i.quantity);
    const anyReceived = items.some((i: any) => i.receivedQuantity > 0);
    const purchase = await prisma.$transaction(async tx => {
      const created = await tx.purchaseOrder.create({ data: { purchaseNumber, supplierId: supplier.id, warehouseId: warehouse.id, userId: session.id, status: allReceived ? "received" : anyReceived ? "partial" : "pending", subtotal, discount, tax, shipping, total, supplierInvoice, paymentMode, paymentMethod: paymentMode === "paid" ? paymentMethod : null, dueDate: paymentMode === "credit" ? dueDate : null, notes, orderedAt: now, receivedAt: allReceived ? now : null, createdAt: now, createdBy: session.id, items: { create: items.map((i: any) => { const p = productMap.get(i.productId)!; const v = i.variantId ? variantMap.get(i.variantId) : null; return { productId: p.id, variantId: v?.id ?? null, productName: p.name, variantName: v?.name ?? null, sku: v?.sku ?? p.sku, orderedQuantity: i.quantity, receivedQuantity: i.receivedQuantity, unitCost: i.unitCost, subtotal: i.quantity * i.unitCost }; }) } } });
      for (const item of items) {
        if (item.receivedQuantity <= 0) continue;
        const product = productMap.get(item.productId)!;
        if (item.variantId) {
          const variant = variantMap.get(item.variantId)!;
          const stock = await tx.productVariantStock.findUnique({ where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } } });
          const previousVariantStock = stock ? Number(stock.quantity) : 0;
          if (stock) await tx.productVariantStock.update({ where: { id: stock.id }, data: { quantity: BigInt(previousVariantStock + item.receivedQuantity), updatedAt: now } });
          else await tx.productVariantStock.create({ data: { variantId: variant.id, warehouseId: warehouse.id, quantity: BigInt(item.receivedQuantity), reservedQuantity: 0n, userId: session.id, createdAt: now, updatedAt: now } });
          const variantStocks = await tx.productVariantStock.findMany({ where: { variantId: variant.id }, select: { quantity: true } });
          const newVariantStock = variantStocks.reduce((sum, a) => sum + Number(a.quantity), 0);
          await tx.productVariant.update({ where: { id: variant.id }, data: { quantity: BigInt(newVariantStock), purchasePrice: item.unitCost, updatedBy: session.id, updatedAt: now } });
          const legacyAllocations = await tx.stockAllocation.findMany({ where: { productId: product.id }, select: { quantity: true } });
          const allVariants = await tx.productVariant.findMany({ where: { productId: product.id }, select: { quantity: true } });
          const newProductStock = legacyAllocations.reduce((sum, a) => sum + Number(a.quantity), 0) + allVariants.reduce((sum, v) => sum + Number(v.quantity), 0);
          const previousProductStock = Number(product.quantity);
          await tx.product.update({ where: { id: product.id }, data: { quantity: BigInt(newProductStock), updatedBy: session.id, updatedAt: now } });
          await tx.inventoryMovement.create({ data: { productId: product.id, variantId: variant.id, warehouseId: warehouse.id, userId: session.id, type: "purchase", quantity: BigInt(item.receivedQuantity), previousStock: BigInt(previousProductStock), newStock: BigInt(newProductStock), reason: "Compra de inventario", referenceId: created.id, notes: `Compra ${purchaseNumber} · ${variant.name}`, createdAt: now } });
        } else {
          const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } } });
          const previousAllocation = allocation ? Number(allocation.quantity) : 0;
          const previousProductStock = Number(product.quantity);
          if (allocation) await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: BigInt(previousAllocation + item.receivedQuantity), updatedAt: now } });
          else await tx.stockAllocation.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: BigInt(item.receivedQuantity), reservedQuantity: 0n, userId: session.id, createdAt: now, updatedAt: now } });
          const allocations = await tx.stockAllocation.findMany({ where: { productId: product.id }, select: { quantity: true } });
          const variantRows = await tx.productVariant.findMany({ where: { productId: product.id }, select: { quantity: true } });
          const newStock = allocations.reduce((sum, a) => sum + Number(a.quantity), 0) + variantRows.reduce((sum, v) => sum + Number(v.quantity), 0);
          await tx.product.update({ where: { id: product.id }, data: { quantity: BigInt(newStock), purchasePrice: item.unitCost, updatedBy: session.id, updatedAt: now } });
          await tx.inventoryMovement.create({ data: { productId: product.id, variantId: null, warehouseId: warehouse.id, userId: session.id, type: "purchase", quantity: BigInt(item.receivedQuantity), previousStock: BigInt(previousProductStock), newStock: BigInt(newStock), reason: "Compra de inventario", referenceId: created.id, notes: `Compra ${purchaseNumber}`, createdAt: now } });
        }
      }
      return created;
    });
    const db = await financeDb();
    const expenseNumber = await nextDocumentNumber("EXP", "Expense", "expenseNumber");
    const expense = { expenseNumber, userId: oid(session.id), amount: total, description: `Compra ${purchaseNumber} · ${supplier.name}`, category: "Compra de inventario", paymentMethod: paymentMode === "paid" ? paymentMethod : "other", paymentStatus: paymentMode === "paid" ? "paid" : "pending", paymentTerms: paymentMode === "credit" ? "credit" : "immediate", purchaseOrderId: oid(purchase.id), supplierId: oid(supplier.id), status: "active", createdBy: oid(session.id), createdAt: now };
    const expenseResult = await db.collection("Expense").insertOne(expense);
    let cashMovementId: string | null = null; let payable: any = null;
    try {
      if (paymentMode === "paid") {
        const movement = await prisma.cashMovement.create({ data: { type: "expense", source: "purchase", amount: total, paymentMethod, userId: session.id, createdBy: session.id, description: `Compra ${purchaseNumber} · ${supplier.name}`, status: "active", createdAt: now } });
        cashMovementId = movement.id;
      } else {
        payable = await upsertPurchasePayable({ userId: session.id, supplierId: supplier.id, supplierName: supplier.name, purchaseOrderId: purchase.id, purchaseNumber, subtotal: subtotal - discount, tax, shipping, receivedItems: items.map((i: any) => ({ receivedQuantity: i.receivedQuantity, unitCost: i.unitCost })), dueDate: dueDate ?? now, now });
      }
    } catch (financeError) {
      await db.collection("Expense").deleteOne({ _id: expenseResult.insertedId });
      await prisma.purchaseOrder.delete({ where: { id: purchase.id } });
      throw financeError;
    }
    await writeAuditLog({ userId: session.id, action: "PURCHASE_CREATED", entityType: "PurchaseOrder", entityId: purchase.id, details: { purchaseNumber, supplierId: supplier.id, total, discount, paymentMode, paymentMethod, warehouseId: warehouse.id, supplierInvoice, cashMovementId, payableId: payable?.id ?? null } });
    await Promise.all([scheduleInvalidateProductCaches(), scheduleInvalidateStockAllocationCaches()]);
    return NextResponse.json({ id: purchase.id, purchaseNumber, total, paymentMode, paymentMethod, cashMovementId, payable, expenseId: expenseResult.insertedId.toHexString() }, { status: 201 });
  } catch (error) {
    console.error("POST /api/purchases", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo registrar la compra" }, { status: 500 });
  }
}
