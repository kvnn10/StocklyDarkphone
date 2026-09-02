import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";
import { calculateDeviceMargin, normalizeImei, normalizeSerial, validateDeviceIdentity } from "@/lib/devices/validation";

const ROLES = new Set(["admin", "user", "retailer"]);
const validId = (v: unknown) => typeof v === "string" && ObjectId.isValid(v);
const text = (v: unknown, max = 200) => typeof v === "string" ? v.trim().slice(0, max) : "";
const money = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) && n >= 0 ? n : null; };

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.has(session.role ?? "")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json();
  const categoryId = text(body.categoryId, 40), supplierId = text(body.supplierId, 40), warehouseId = text(body.warehouseId, 40);
  if (!validId(categoryId) || !validId(supplierId) || !validId(warehouseId)) return NextResponse.json({ error: "Categoría, proveedor y bodega son obligatorios" }, { status: 400 });
  const name = text(body.name, 120), brand = text(body.brand, 80), model = text(body.model, 120);
  const imei1 = normalizeImei(body.imei1), imei2 = normalizeImei(body.imei2), serial = normalizeSerial(body.serial);
  const identityError = validateDeviceIdentity({ imei1, imei2, serial, phonePasscode: body.phonePasscode });
  if (identityError) return NextResponse.json({ error: identityError }, { status: 400 });
  if (!name || !model) return NextResponse.json({ error: "Nombre y modelo son obligatorios" }, { status: 400 });
  const purchasePrice = money(body.purchasePrice), repairCost = money(body.repairCost), salePrice = money(body.salePrice);
  if (purchasePrice === null || repairCost === null || salePrice === null) return NextResponse.json({ error: "Valores de compra, reparación o venta inválidos" }, { status: 400 });
  const warrantyDays = Number(body.warrantyDays ?? 0);
  if (!Number.isInteger(warrantyDays) || warrantyDays < 0 || warrantyDays > 3650) return NextResponse.json({ error: "Garantía inválida" }, { status: 400 });

  const [category, supplier, warehouse] = await Promise.all([
    prisma.category.findFirst({ where: { id: categoryId, userId: session.id, status: true } }),
    prisma.supplier.findFirst({ where: { id: supplierId, userId: session.id, status: true } }),
    prisma.warehouse.findFirst({ where: { id: warehouseId, userId: session.id, status: true } }),
  ]);
  if (!category) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  if (!warehouse) return NextResponse.json({ error: "Bodega no encontrada" }, { status: 404 });

  const client = new MongoClient(process.env.DATABASE_URL!);
  let createdProductId: string | null = null;
  let createdPurchaseId: string | null = null;
  try {
    await client.connect();
    const devices = client.db().collection("CustomerDevice");
    const ids = [imei1, imei2].filter(Boolean);
    const duplicateOr: any[] = [];
    if (ids.length) duplicateOr.push({ imei1: { $in: ids } }, { imei2: { $in: ids } });
    if (serial) duplicateOr.push({ serial });
    if (duplicateOr.length && await devices.findOne({ userId: session.id, archivedAt: { $exists: false }, $or: duplicateOr })) return NextResponse.json({ error: "El IMEI o serial ya está registrado en otro equipo" }, { status: 409 });

    const sku = `DP-${imei1 || imei2 || serial}`;
    if (await prisma.product.findFirst({ where: { userId: session.id, sku } })) return NextResponse.json({ error: "Ya existe un producto de inventario para este equipo" }, { status: 409 });
    const purchaseNumber = `UC-${Date.now().toString().slice(-10)}`;
    const now = new Date();
    const margin = calculateDeviceMargin(purchasePrice, repairCost, salePrice);
    const product = await prisma.product.create({ data: { categoryId, name, price: salePrice, purchasePrice, quantity: 1n, reservedQuantity: 0n, sku, status: "active", supplierId, userId: session.id, createdBy: session.id } });
    createdProductId = product.id;
    await prisma.stockAllocation.create({ data: { productId: product.id, warehouseId, quantity: 1n, reservedQuantity: 0n, userId: session.id } });
    await prisma.inventoryMovement.create({ data: { productId: product.id, warehouseId, userId: session.id, type: "entry", quantity: 1n, previousStock: 0n, newStock: 1n, reason: "used_device_purchase", notes: purchaseNumber } });
    const purchase = await prisma.purchaseOrder.create({ data: { purchaseNumber, supplierId, userId: session.id, status: "received", subtotal: purchasePrice, total: purchasePrice, orderedAt: now, receivedAt: now, createdBy: session.id, updatedBy: session.id, items: { create: [{ productId: product.id, productName: name, sku, orderedQuantity: 1, receivedQuantity: 1, unitCost: purchasePrice, subtotal: purchasePrice }] } } });
    createdPurchaseId = purchase.id;
    const warrantyExpiresAt = warrantyDays > 0 ? new Date(now.getTime() + warrantyDays * 86400000) : null;
    const result = await devices.insertOne({ userId: session.id, name, brand, model, imei1, imei2, serial, clientName: text(body.clientName, 160), phonePasscode: text(body.phonePasscode, 8) || null, status: "available", purchasePrice, repairCost, salePrice, ...margin, warrantyDays, warrantyExpiresAt, productId: product.id, purchaseOrderId: purchase.id, warehouseId, purchaseType: "used", notes: text(body.notes, 1000), createdAt: now, updatedAt: now, createdBy: session.id });
    await writeAuditLog({ userId: session.id, action: "DEVICE_PURCHASED", entityType: "CustomerDevice", entityId: result.insertedId.toHexString(), details: { productId: product.id, purchaseOrderId: purchase.id, warehouseId, purchasePrice, salePrice } });
    return NextResponse.json({ id: result.insertedId.toHexString(), productId: product.id, purchaseOrderId: purchase.id, sku, status: "available" }, { status: 201 });
  } catch (error) {
    console.error("POST /api/devices/purchase", error);
    if (createdPurchaseId) await prisma.purchaseOrder.delete({ where: { id: createdPurchaseId } }).catch(() => undefined);
    if (createdProductId) await prisma.product.delete({ where: { id: createdProductId } }).catch(() => undefined);
    return NextResponse.json({ error: "No se pudo registrar la compra del equipo" }, { status: 500 });
  } finally { await client.close(); }
}
