import { MongoClient, ObjectId } from "mongodb";
import { prisma } from "@/prisma/client";

const client = new MongoClient(process.env.DATABASE_URL!);

async function main() {
  await client.connect();
  const legacy = client.db().collection("ServiceOrder");
  const docs = await legacy.find({}).sort({ createdAt: 1 }).toArray();
  let migrated = 0;
  let skipped = 0;

  for (const doc of docs as any[]) {
    const orderNumber = String(doc.orderNumber ?? `ST-MIG-${String(doc._id)}`);
    if (await prisma.serviceOrder.findUnique({ where: { orderNumber } })) {
      skipped += 1;
      continue;
    }

    const userId = String(doc.userId ?? "");
    if (!/^[a-f\d]{24}$/i.test(userId)) {
      console.warn(`Skipping ${orderNumber}: invalid userId`);
      skipped += 1;
      continue;
    }

    const parts = Array.isArray(doc.parts) ? doc.parts : [];
    const payments = Array.isArray(doc.payments) ? doc.payments : [];
    const accessories = {
      customerName: String(doc.customer ?? ""),
      customerPhone: String(doc.phone ?? ""),
      statusHistory: Array.isArray(doc.statusHistory) ? doc.statusHistory : [{ status: String(doc.status ?? "received"), at: new Date(doc.createdAt ?? Date.now()).toISOString(), by: userId }],
      photos: Array.isArray(doc.photos) ? doc.photos : [],
      partWarranties: Object.fromEntries(parts.filter((p: any) => p?.warrantyDays !== undefined).map((p: any) => [String(p.id), { warrantyDays: Number(p.warrantyDays ?? 0), warrantyUntil: p.warrantyUntil ? new Date(p.warrantyUntil).toISOString() : null, warrantySource: p.warrantySource ?? "legacy" }])),
      partWarehouses: Object.fromEntries(parts.filter((p: any) => p?.id).map((p: any) => [String(p.id), String(p.warehouseName ?? "")]).filter(([, name]) => name)),
      warrantyReentry: Boolean(doc.warrantyReentry),
      warrantyOriginalOrderId: doc.warrantyOriginalOrderId ? String(doc.warrantyOriginalOrderId) : null,
      warrantyOriginalOrderNumber: doc.warrantyOriginalOrderNumber ?? null,
      warrantyPartId: doc.warrantyPartId ?? null,
      warrantyPartName: doc.warrantyPartName ?? null,
      warrantyReason: doc.warrantyReason ?? null,
    };

    const created = await prisma.serviceOrder.create({
      data: {
        orderNumber,
        userId,
        technicianId: /^[a-f\d]{24}$/i.test(String(doc.technicianId ?? "")) ? String(doc.technicianId) : null,
        deviceType: "phone",
        brand: "",
        model: String(doc.device ?? ""),
        imei: doc.imei ? String(doc.imei) : null,
        serialNumber: doc.serial ? String(doc.serial) : null,
        reportedIssue: String(doc.issue ?? ""),
        diagnosis: doc.diagnosis ? String(doc.diagnosis) : null,
        workPerformed: doc.technicianNotes ? String(doc.technicianNotes) : null,
        status: String(doc.status ?? "received"),
        laborAmount: Number(doc.labor ?? 0),
        partsAmount: parts.reduce((sum: number, p: any) => sum + Number(p?.subtotal ?? 0), 0),
        discount: Number(doc.discount ?? 0),
        total: Number(doc.total ?? 0),
        amountPaid: Number(doc.paid ?? 0),
        amountDue: Number(doc.balance ?? Math.max(0, Number(doc.total ?? 0) - Number(doc.paid ?? 0))),
        warrantyDays: Number(doc.warrantyDays ?? 0),
        warrantyExpiresAt: doc.warrantyUntil ? new Date(doc.warrantyUntil) : null,
        accessories,
        notes: doc.notes ? String(doc.notes) : null,
        createdAt: new Date(doc.createdAt ?? Date.now()),
        updatedAt: new Date(doc.updatedAt ?? doc.createdAt ?? Date.now()),
        createdBy: userId,
        updatedBy: userId,
        items: {
          create: parts.map((p: any) => ({
            productId: /^[a-f\d]{24}$/i.test(String(p.productId ?? "")) ? String(p.productId) : null,
            warehouseId: /^[a-f\d]{24}$/i.test(String(p.warehouseId ?? "")) ? String(p.warehouseId) : null,
            productName: String(p.name ?? ""),
            sku: p.sku ? String(p.sku) : null,
            quantity: Math.max(1, Number(p.quantity ?? 1)),
            unitCost: Math.max(0, Number(p.unitCost ?? 0)),
            unitPrice: Math.max(0, Number(p.unitPrice ?? 0)),
            subtotal: Math.max(0, Number(p.subtotal ?? 0)),
            inventoryApplied: Boolean(p.consumed),
            createdAt: new Date(p.addedAt ?? doc.createdAt ?? Date.now()),
          })),
        },
        payments: {
          create: payments.filter((p: any) => Number(p.amount) > 0).map((p: any) => ({
            userId,
            recordedBy: userId,
            amount: Number(p.amount),
            paymentMethod: String(p.paymentMethod ?? "cash"),
            status: "paid",
            createdAt: new Date(p.at ?? doc.createdAt ?? Date.now()),
          })),
        },
      },
    });

    if (created) migrated += 1;
  }

  console.log(`ServiceOrder migration complete: ${migrated} migrated, ${skipped} skipped.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await client.close();
  await prisma.$disconnect();
});
