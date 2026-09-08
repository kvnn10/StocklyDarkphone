import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";

export async function GET(_request: NextRequest) {
  const auth = await authorizeRequest(_request, "finance", "read");
  if (auth.response) return auth.response;
  const session = auth.session!;

  const rows = await prisma.purchaseOrder.findMany({
    where: { userId: session.id, status: "cancelled" },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const supplierIds = [...new Set(rows.map(r => r.supplierId))];
  const warehouseIds = [...new Set(rows.map(r => r.warehouseId).filter(Boolean) as string[])];
  const [suppliers, warehouses, audits] = await Promise.all([
    supplierIds.length ? prisma.supplier.findMany({ where: { id: { in: supplierIds }, userId: session.id }, select: { id: true, name: true } }) : [],
    warehouseIds.length ? prisma.warehouse.findMany({ where: { id: { in: warehouseIds }, userId: session.id }, select: { id: true, name: true } }) : [],
    rows.length ? prisma.auditLog.findMany({ where: { userId: session.id, action: "PURCHASE_VOIDED", entityType: "PurchaseOrder", entityId: { in: rows.map(r => r.id) } }, orderBy: { createdAt: "desc" }, take: 500, select: { entityId: true, createdAt: true, details: true } }) : [],
  ]);

  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));
  const warehouseMap = new Map(warehouses.map(w => [w.id, w.name]));
  const auditMap = new Map<string, any>();
  for (const audit of audits) if (audit.entityId && !auditMap.has(audit.entityId)) auditMap.set(audit.entityId, audit);

  return NextResponse.json(rows.map(row => {
    const audit = auditMap.get(row.id);
    const details = audit?.details && typeof audit.details === "object" ? audit.details as Record<string, unknown> : {};
    return {
      id: row.id,
      purchaseNumber: row.purchaseNumber,
      supplierName: supplierMap.get(row.supplierId) ?? "Proveedor",
      warehouseName: row.warehouseId ? warehouseMap.get(row.warehouseId) ?? "Almacén" : "—",
      supplierInvoice: row.supplierInvoice,
      total: Number(row.total),
      createdAt: row.createdAt,
      notes: row.notes,
      status: row.status,
      cancelledAt: audit?.createdAt ?? null,
      reason: typeof details.reason === "string" ? details.reason : null,
      reversedItems: Array.isArray(details.reversedItems) ? details.reversedItems : [],
      items: row.items.map(item => ({ productName: item.productName, variantName: item.variantName, sku: item.sku, orderedQuantity: item.orderedQuantity, receivedQuantity: item.receivedQuantity, returnedQuantity: item.returnedQuantity, unitCost: Number(item.unitCost) })),
    };
  }));
}
