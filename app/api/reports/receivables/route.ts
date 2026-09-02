import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const ROLES = ["admin", "user", "retailer"] as const;
const round = (n: number) => Math.round(n * 100) / 100;
const parseDate = (v: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

async function getClientMap(ids: string[]) {
  const map = new Map<string, { name: string; email: string; phone?: string; whatsapp?: string; document?: string }>();
  if (!ids.length) return map;
  const mongo = new MongoClient(process.env.DATABASE_URL!);
  await mongo.connect();
  try {
    const rows = await mongo.db().collection("User").find({ _id: { $in: ids.filter(ObjectId.isValid).map(id => new ObjectId(id)) }, role: "client" }, { projection: { name: 1, email: 1, phone: 1, whatsapp: 1, document: 1 } }).toArray();
    for (const row of rows as any[]) map.set(String(row._id), { name: row.name || "Cliente sin nombre", email: row.email || "", phone: row.phone, whatsapp: row.whatsapp, document: row.document });
  } finally { await mongo.close(); }
  return map;
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as (typeof ROLES)[number])) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const params = request.nextUrl.searchParams;
    const from = parseDate(params.get("from"));
    const to = parseDate(params.get("to"));
    if (from && to && from > to) return NextResponse.json({ error: "El rango de fechas es inválido" }, { status: 400 });
    const type = params.get("type") || "all";
    const query = (params.get("q") || "").trim().toLowerCase();
    const dateWhere = from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};

    const [orders, repairs] = await Promise.all([
      type === "repair" ? Promise.resolve([]) : prisma.order.findMany({ where: { userId: session.id, clientId: { not: null }, status: { not: "cancelled" }, ...dateWhere }, select: { id: true, orderNumber: true, clientId: true, total: true, createdAt: true, invoice: { select: { dueDate: true } } }, orderBy: { createdAt: "asc" } }),
      type === "sale" ? Promise.resolve([]) : prisma.serviceOrder.findMany({ where: { userId: session.id, clientId: { not: null }, status: { not: "cancelled" }, ...dateWhere }, select: { id: true, orderNumber: true, clientId: true, total: true, amountPaid: true, amountDue: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    ]);

    const saleIds = orders.map(o => o.id);
    const repairIds = repairs.map(o => o.id);
    const [salePayments, repairPayments] = await Promise.all([
      saleIds.length ? prisma.salePayment.findMany({ where: { userId: session.id, orderId: { in: saleIds }, status: "paid" }, select: { orderId: true, amount: true } }) : Promise.resolve([]),
      repairIds.length ? prisma.serviceOrderPayment.findMany({ where: { userId: session.id, serviceOrderId: { in: repairIds }, status: "paid" }, select: { serviceOrderId: true, amount: true } }) : Promise.resolve([]),
    ]);
    const paidSales = new Map<string, number>();
    for (const p of salePayments) paidSales.set(p.orderId, (paidSales.get(p.orderId) || 0) + Number(p.amount || 0));
    const paidRepairs = new Map<string, number>();
    for (const p of repairPayments) paidRepairs.set(p.serviceOrderId, (paidRepairs.get(p.serviceOrderId) || 0) + Number(p.amount || 0));

    const entries = [
      ...orders.map(o => { const total = Number(o.total || 0); const paid = paidSales.get(o.id) || 0; return { id: o.id, type: "sale", typeLabel: "Venta", number: o.orderNumber, clientId: o.clientId!, total, paid, balance: Math.max(0, total - paid), createdAt: o.createdAt.toISOString(), dueDate: o.invoice?.dueDate?.toISOString() || null }; }),
      ...repairs.map(o => { const total = Number(o.total || 0); const paid = paidRepairs.get(o.id) || 0; return { id: o.id, type: "repair", typeLabel: "Reparación", number: o.orderNumber, clientId: o.clientId!, total, paid, balance: Math.max(0, total - paid), createdAt: o.createdAt.toISOString(), dueDate: null }; }),
    ].filter(e => e.balance > 0.009);

    const clientMap = await getClientMap([...new Set(entries.map(e => e.clientId))]);
    const enriched = entries.map(e => ({ ...e, client: clientMap.get(e.clientId) || { name: "Cliente no encontrado", email: "" } }))
      .filter(e => !query || `${e.client.name} ${e.client.email} ${e.client.phone || ""} ${e.client.whatsapp || ""} ${e.client.document || ""} ${e.number}`.toLowerCase().includes(query))
      .sort((a, b) => b.balance - a.balance);

    const now = Date.now();
    const data = enriched.map(e => ({ ...e, pendingDays: Math.max(0, Math.floor((now - new Date(e.createdAt).getTime()) / 86400000)), overdueDays: e.dueDate ? Math.max(0, Math.floor((now - new Date(e.dueDate).getTime()) / 86400000)) : null }));
    const summary = { total: round(data.reduce((s, e) => s + e.balance, 0)), sales: round(data.filter(e => e.type === "sale").reduce((s, e) => s + e.balance, 0)), repairs: round(data.filter(e => e.type === "repair").reduce((s, e) => s + e.balance, 0)), clients: new Set(data.map(e => e.clientId)).size, documents: data.length };

    await writeAuditLog({ userId: session.id, action: "RECEIVABLES_REPORT_VIEWED", entityType: "ReceivablesReport", details: { from: from?.toISOString() || null, to: to?.toISOString() || null, type, query: query || null, summary }, userAgent: request.headers.get("user-agent"), ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip") });
    return NextResponse.json({ summary, entries: data });
  } catch (error) {
    console.error("GET /api/reports/receivables", error);
    return NextResponse.json({ error: "No se pudo generar la cartera" }, { status: 500 });
  }
}
