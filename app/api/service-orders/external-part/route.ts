import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";
import { invalidateOnProductChange } from "@/lib/cache";

const money = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; };
const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !["admin", "user", "retailer"].includes(session.role ?? "")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const quantity = Number(body.quantity);
    const purchaseCost = money(body.purchaseCost);
    const salePrice = money(body.salePrice);
    const warrantyDays = Number(body.warrantyDays ?? 0);
    const addToInventory = Boolean(body.addToInventory);
    const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
    const supplierId = typeof body.supplierId === "string" ? body.supplierId : "";
    const supplierName = typeof body.supplierName === "string" ? body.supplierName.trim() : "";
    const invoiceRef = typeof body.invoiceRef === "string" ? body.invoiceRef.trim() : "";
    if (!validId(orderId)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "El nombre del repuesto es obligatorio" }, { status: 400 });
    if (!Number.isInteger(quantity) || quantity <= 0) return NextResponse.json({ error: "La cantidad debe ser un entero mayor que cero" }, { status: 400 });
    if (purchaseCost === null || salePrice === null) return NextResponse.json({ error: "Costo y precio deben ser valores válidos" }, { status: 400 });
    if (!Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) return NextResponse.json({ error: "Garantía inválida" }, { status: 400 });
    if (addToInventory && (!validId(categoryId) || !validId(supplierId))) return NextResponse.json({ error: "Para agregar al inventario selecciona categoría y proveedor" }, { status: 400 });

    const existing = await prisma.serviceOrder.findFirst({ where: { id: orderId, userId: session.id }, include: { items: true, payments: true } });
    if (!existing) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    if (["delivered", "cancelled"].includes(existing.status)) return NextResponse.json({ error: "La orden está cerrada y no admite repuestos" }, { status: 409 });

    const result = await prisma.$transaction(async tx => {
      let productId: string | null = null;
      let sku = `EXT-${existing.orderNumber}-${Date.now()}`;
      let warehouseId: string | null = null;
      let warehouseName = "Compra puntual";

      if (addToInventory) {
        const category = await tx.category.findFirst({ where: { id: categoryId, userId: session.id, status: true } });
        const supplier = await tx.supplier.findFirst({ where: { id: supplierId, userId: session.id, status: true } });
        const warehouse = await tx.warehouse.findFirst({ where: { userId: session.id, status: true }, orderBy: { createdAt: "asc" } });
        if (!category) throw new Error("La categoría seleccionada no existe o está inactiva");
        if (!supplier) throw new Error("El proveedor seleccionado no existe o está inactivo");
        if (!warehouse) throw new Error("No tienes una bodega activa. Crea una bodega antes de agregar repuestos al inventario.");
        const product = await tx.product.create({ data: { name, sku, purchasePrice: purchaseCost, price: salePrice, quantity: BigInt(quantity), status: quantity > 20 ? "Available" : "Stock Low", categoryId, supplierId, userId: session.id, createdBy: session.id } });
        productId = product.id;
        sku = product.sku;
        warehouseId = warehouse.id;
        warehouseName = warehouse.name;
        await tx.stockAllocation.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: BigInt(quantity), reservedQuantity: BigInt(0), userId: session.id } });
        await tx.inventoryMovement.create({ data: { productId: product.id, warehouseId: warehouse.id, userId: session.id, type: "purchase", quantity: BigInt(quantity), previousStock: BigInt(0), newStock: BigInt(quantity), reason: "Compra puntual para orden de servicio", referenceId: orderId, notes: invoiceRef || supplierName || null } });
      }

      const item = await tx.serviceOrderItem.create({ data: { serviceOrderId: orderId, productId, warehouseId, productName: name, sku, quantity, unitPrice: salePrice, unitCost: purchaseCost, subtotal: quantity * salePrice } });
      const partsAmount = existing.items.reduce((sum, i) => sum + Number(i.subtotal), 0) + item.subtotal;
      const total = Math.max(0, partsAmount + existing.laborAmount - existing.discount);
      if (existing.amountPaid > total) throw new Error("El nuevo total no puede ser menor a lo ya pagado");
      const updated = await tx.serviceOrder.update({ where: { id: orderId }, data: { partsAmount, total, amountDue: total - existing.amountPaid, updatedAt: new Date(), updatedBy: session.id }, include: { items: true, payments: true } });
      return { item, updated, productId, warehouseId, warehouseName };
    });

    if (addToInventory) await invalidateOnProductChange();
    await writeAuditLog({ userId: session.id, action: "SERVICE_EXTERNAL_PART_ADDED", entityType: "ServiceOrder", entityId: orderId, details: { itemId: result.item.id, productId: result.productId, warehouseId: result.warehouseId, warrantyDays, supplierName, invoiceRef } });
    return NextResponse.json({ part: { id: result.item.id, productId: result.item.productId ?? `external-${result.item.id}`, name: result.item.productName, sku: result.item.sku ?? "", quantity: result.item.quantity, unitPrice: result.item.unitPrice, unitCost: result.item.unitCost, subtotal: result.item.subtotal, costSubtotal: result.item.quantity * result.item.unitCost, consumed: !addToInventory, warehouseId: result.warehouseId ?? "", warehouseName: result.warehouseName, external: true, purchaseType: "spot", supplierName, invoiceRef, warrantyDays }, inventoryProductId: result.productId, inventoryWarehouseId: result.warehouseId, order: result.updated }, { status: 201 });
  } catch (error: any) {
    if (["La categoría seleccionada no existe o está inactiva", "El proveedor seleccionado no existe o está inactivo", "No tienes una bodega activa. Crea una bodega antes de agregar repuestos al inventario.", "El nuevo total no puede ser menor a lo ya pagado"].includes(error?.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("POST /api/service-orders/external-part", error);
    return NextResponse.json({ error: "No se pudo agregar el repuesto de compra puntual" }, { status: 500 });
  }
}
