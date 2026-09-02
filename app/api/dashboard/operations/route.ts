import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";

const ALLOWED_ROLES = ["admin", "user", "retailer"];
const OPEN_REPAIR_STATUSES = ["received", "diagnosis", "awaiting_approval", "repairing", "ready"];
const OPEN_PURCHASE_STATUSES = ["draft", "partial"];

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ALLOWED_ROLES.includes(session.role ?? "")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const now = new Date();
    const repairCutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    const [products, repairs, purchaseOrders, invoices, serviceOrders] = await Promise.all([
      prisma.product.findMany({
        where: { userId: session.id, deletedAt: null },
        select: { id: true, name: true, sku: true, quantity: true, reservedQuantity: true },
        orderBy: { quantity: "asc" },
      }),
      prisma.serviceOrder.findMany({
        where: { userId: session.id, status: { in: OPEN_REPAIR_STATUSES }, createdAt: { lt: repairCutoff } },
        select: { id: true, orderNumber: true, brand: true, model: true, status: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 8,
      }),
      prisma.purchaseOrder.findMany({
        where: { userId: session.id, status: { in: OPEN_PURCHASE_STATUSES } },
        select: { id: true, purchaseNumber: true, status: true, total: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 8,
      }),
      prisma.invoice.findMany({
        where: { userId: session.id, amountDue: { gt: 0 }, dueDate: { lt: now }, status: { not: "cancelled" } },
        select: { id: true, invoiceNumber: true, amountDue: true, dueDate: true },
        orderBy: { dueDate: "asc" },
        take: 8,
      }),
      prisma.serviceOrder.findMany({
        where: { userId: session.id, amountDue: { gt: 0 }, status: { not: "cancelled" } },
        select: { id: true, orderNumber: true, amountDue: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 8,
      }),
    ]);

    const stockCritical = products.filter((p) => Number(p.quantity) > 0 && Number(p.quantity) <= 2);
    const outOfStock = products.filter((p) => Number(p.quantity) <= 0);
    const reserved = products.filter((p) => Number(p.reservedQuantity) > 0 && Number(p.quantity) < Number(p.reservedQuantity));

    const overdueRepairs = repairs.map((r) => ({
      id: r.id,
      number: r.orderNumber,
      device: [r.brand, r.model].filter(Boolean).join(" ").trim() || "Equipo",
      status: r.status,
      daysOpen: Math.max(1, Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / 86400000)),
    }));

    const pendingPurchases = purchaseOrders.map((p) => ({
      id: p.id,
      number: p.purchaseNumber,
      status: p.status,
      total: Number(p.total || 0),
    }));

    const overdueSales = invoices.map((i) => ({
      id: i.id,
      number: i.invoiceNumber,
      amountDue: Number(i.amountDue || 0),
      daysOverdue: Math.max(1, Math.floor((now.getTime() - new Date(i.dueDate).getTime()) / 86400000)),
    }));

    const serviceBalances = serviceOrders.map((s) => ({
      id: s.id,
      number: s.orderNumber,
      amountDue: Number(s.amountDue || 0),
      daysOpen: Math.max(0, Math.floor((now.getTime() - new Date(s.createdAt).getTime()) / 86400000)),
    }));

    const counts = {
      outOfStock: outOfStock.length,
      stockCritical: stockCritical.length,
      overdueReceivables: overdueSales.length + serviceBalances.filter((s) => s.daysOpen >= 30).length,
      overdueRepairs: overdueRepairs.length,
      pendingPurchases: pendingPurchases.length,
      reservationIssues: reserved.length,
    };

    return NextResponse.json({
      generatedAt: now.toISOString(),
      counts,
      stock: {
        outOfStock: outOfStock.slice(0, 8).map((p) => ({ id: p.id, name: p.name, sku: p.sku, quantity: Number(p.quantity) })),
        critical: stockCritical.slice(0, 8).map((p) => ({ id: p.id, name: p.name, sku: p.sku, quantity: Number(p.quantity) })),
      },
      receivables: {
        overdueInvoices: overdueSales,
        serviceBalances: serviceBalances.filter((s) => s.daysOpen >= 30),
      },
      repairs: overdueRepairs,
      purchases: pendingPurchases,
      reservationIssues: reserved.slice(0, 8).map((p) => ({ id: p.id, name: p.name, quantity: Number(p.quantity), reserved: Number(p.reservedQuantity) })),
    });
  } catch (error) {
    console.error("GET /api/dashboard/operations", error);
    return NextResponse.json({ error: "No se pudo cargar el centro de operaciones" }, { status: 500 });
  }
}
