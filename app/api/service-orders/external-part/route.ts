import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";
import { invalidateOnProductChange } from "@/lib/cache";

const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

async function db() {
  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  return client;
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !["admin", "user", "retailer"].includes(session.role ?? "")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

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

  if (!ObjectId.isValid(orderId)) return NextResponse.json({ error: "Orden inválida" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "El nombre del repuesto es obligatorio" }, { status: 400 });
  if (!Number.isInteger(quantity) || quantity <= 0) return NextResponse.json({ error: "La cantidad debe ser un entero mayor que cero" }, { status: 400 });
  if (purchaseCost === null || salePrice === null) return NextResponse.json({ error: "Costo y precio deben ser valores válidos" }, { status: 400 });
  if (!Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) return NextResponse.json({ error: "Garantía inválida" }, { status: 400 });
  if (addToInventory && (!categoryId || !supplierId)) return NextResponse.json({ error: "Para agregar al inventario selecciona categoría y proveedor" }, { status: 400 });

  const client = await db();
  try {
    const orders = client.db().collection("ServiceOrder");
    const existing = await orders.findOne({ _id: new ObjectId(orderId), userId: session.id });
    if (!existing) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    if (existing.status === "delivered" || existing.status === "cancelled") return NextResponse.json({ error: "La orden está cerrada y no admite repuestos" }, { status: 409 });

    let productId = `external-${new ObjectId().toString()}`;
    let sku = `EXT-${existing.orderNumber}-${Date.now()}`;
    let inventoryProductId: string | null = null;

    if (addToInventory) {
      const [category, supplier] = await Promise.all([
        prisma.category.findFirst({ where: { id: categoryId, userId: session.id, status: true } }),
        prisma.supplier.findFirst({ where: { id: supplierId, userId: session.id, status: true } }),
      ]);
      if (!category) return NextResponse.json({ error: "La categoría seleccionada no existe o está inactiva" }, { status: 400 });
      if (!supplier) return NextResponse.json({ error: "El proveedor seleccionado no existe o está inactivo" }, { status: 400 });

      const product = await prisma.product.create({
        data: {
          name,
          sku,
          purchasePrice: purchaseCost,
          price: salePrice,
          quantity: BigInt(quantity) as any,
          status: quantity > 20 ? "Available" : "Stock Low",
          categoryId,
          supplierId,
          userId: session.id,
          createdBy: session.id,
          createdAt: new Date(),
          updatedAt: null,
        },
      });
      productId = product.id;
      sku = product.sku;
      inventoryProductId = product.id;
      await invalidateOnProductChange();
    }

    const partId = new ObjectId().toString();
    const part = {
      id: partId,
      productId,
      name,
      sku,
      quantity,
      unitPrice: salePrice,
      unitCost: purchaseCost,
      subtotal: quantity * salePrice,
      costSubtotal: quantity * purchaseCost,
      consumed: !addToInventory,
      warehouseId: "",
      warehouseName: addToInventory ? "Pendiente de descontar de inventario" : "Compra puntual",
      external: true,
      purchaseType: "spot",
      supplierName,
      invoiceRef,
      warrantyDays,
      warrantyUntil: null,
      addedAt: new Date(),
      addedBy: session.id,
    };

    const parts = [...((existing.parts as any[]) || []), part];
    const subtotalParts = parts.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const total = Math.max(0, subtotalParts + Number(existing.labor || 0) - Number(existing.discount || 0));
    await orders.updateOne(
      { _id: existing._id },
      { $set: { parts, total, balance: total - Number(existing.paid || 0), updatedAt: new Date(), updatedBy: session.id } },
    );

    await writeAuditLog({
      userId: session.id,
      action: "SERVICE_EXTERNAL_PART_ADDED",
      entityType: "ServiceOrder",
      entityId: orderId,
      details: { part, addToInventory, inventoryProductId },
    });

    return NextResponse.json({ part, inventoryProductId, order: await orders.findOne({ _id: existing._id }) }, { status: 201 });
  } catch (error) {
    console.error("POST /api/service-orders/external-part", error);
    return NextResponse.json({ error: "No se pudo agregar el repuesto de compra puntual" }, { status: 500 });
  } finally {
    await client.close();
  }
}
