import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const ROLES = ["admin", "user", "retailer"] as const;
const allowed = (role?: string | null) => ROLES.includes(role as (typeof ROLES)[number]);
const round = (n: number) => Math.round(n * 100) / 100;

async function getClient(id: string) {
  const mongo = new MongoClient(process.env.DATABASE_URL!);
  await mongo.connect();
  try {
    return await mongo.db().collection("User").findOne({ _id: new ObjectId(id), role: "client" }, { projection: { password: 0 } });
  } finally { await mongo.close(); }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session.role)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
  try {
    const client = await getClient(id);
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const [orders, repairs] = await Promise.all([
      prisma.order.findMany({ where: { userId: session.id, clientId: id }, select: { id: true, orderNumber: true, status: true, paymentStatus: true, total: true, createdAt: true, invoice: { select: { invoiceNumber: true, dueDate: true, status: true } } }, orderBy: { createdAt: "desc" } }),
      prisma.serviceOrder.findMany({ where: { userId: session.id, clientId: id }, select: { id: true, orderNumber: true, status: true, total: true, amountPaid: true, amountDue: true, deviceType: true, brand: true, model: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    ]);
    const saleIds = orders.map(o => o.id), repairIds = repairs.map(o => o.id);
    const [salePayments, repairPayments] = await Promise.all([
      saleIds.length ? prisma.salePayment.findMany({ where: { userId: session.id, orderId: { in: saleIds }, status: "paid" }, select: { id: true, orderId: true, amount: true, paymentMethod: true, createdAt: true, orderNumber: true }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
      repairIds.length ? prisma.serviceOrderPayment.findMany({ where: { userId: session.id, serviceOrderId: { in: repairIds }, status: "paid" }, select: { id: true, serviceOrderId: true, amount: true, paymentMethod: true, createdAt: true }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    ]);
    const paidSales = new Map<string, number>(); for (const p of salePayments) paidSales.set(p.orderId, (paidSales.get(p.orderId) || 0) + Number(p.amount || 0));
    const paidRepairs = new Map<string, number>(); for (const p of repairPayments) paidRepairs.set(p.serviceOrderId, (paidRepairs.get(p.serviceOrderId) || 0) + Number(p.amount || 0));
    const salesTotal = orders.reduce((s, o) => s + Number(o.total || 0), 0);
    const repairsTotal = repairs.reduce((s, o) => s + Number(o.total || 0), 0);
    const salesPaid = orders.reduce((s, o) => s + (paidSales.get(o.id) || 0), 0);
    const repairsPaid = repairs.reduce((s, o) => s + (paidRepairs.get(o.id) || 0), 0);
    const movements = [
      ...salePayments.map(p => ({ id: p.id, type: "sale", number: p.orderNumber, amount: Number(p.amount || 0), paymentMethod: p.paymentMethod, createdAt: p.createdAt.toISOString() })),
      ...repairPayments.map(p => ({ id: p.id, type: "repair", number: repairs.find(r => r.id === p.serviceOrderId)?.orderNumber || "", amount: Number(p.amount || 0), paymentMethod: p.paymentMethod, createdAt: p.createdAt.toISOString() })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const data = {
      client: { ...client, id: client._id.toString(), _id: undefined },
      summary: { purchases: round(salesTotal + repairsTotal), paid: round(salesPaid + repairsPaid), balance: round(Math.max(0, salesTotal + repairsTotal - salesPaid - repairsPaid)), sales: orders.length, repairs: repairs.length },
      orders: orders.map(o => ({ ...o, total: Number(o.total || 0), paid: round(paidSales.get(o.id) || 0), balance: round(Math.max(0, Number(o.total || 0) - (paidSales.get(o.id) || 0))), createdAt: o.createdAt.toISOString(), invoice: o.invoice ? { ...o.invoice, dueDate: o.invoice.dueDate.toISOString() } : null })),
      repairs: repairs.map(o => ({ ...o, total: Number(o.total || 0), paid: round(paidRepairs.get(o.id) || 0), balance: round(Math.max(0, Number(o.total || 0) - (paidRepairs.get(o.id) || 0))), createdAt: o.createdAt.toISOString() })),
      payments: movements,
    };
    await writeAuditLog({ userId: session.id, action: "CLIENT_ACCOUNT_VIEWED", entityType: "Client", entityId: id, details: { balance: data.summary.balance, sales: orders.length, repairs: repairs.length }, userAgent: request.headers.get("user-agent"), ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip") });
    return NextResponse.json(data);
  } catch (error) {
    console.error("GET /api/clients/[id]", error);
    return NextResponse.json({ error: "No se pudo cargar la ficha del cliente" }, { status: 500 });
  }
}
