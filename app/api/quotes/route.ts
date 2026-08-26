import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

const allowed = (session: any) => !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
async function db() { const client = new MongoClient(process.env.DATABASE_URL!); await client.connect(); return client; }

type QuoteItem = { productId: string; name: string; quantity: number; unitPrice: number };
type QuoteRecord = { userId: string; quoteNumber: string; customerId: string | null; customerName: string; customerPhone: string; customerEmail: string; notes: string; validUntil: Date | null; status: string; items: QuoteItem[]; subtotal: number; discount: number; total: number; createdAt: Date; updatedAt: Date; createdBy: string; convertedOrderId?: string; convertedOrderNumber?: string; convertedInvoiceId?: string; convertedInvoiceNumber?: string; convertedAt?: Date };

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request); if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const client = await db();
  try { const q = new URL(request.url).searchParams.get("search")?.trim() ?? ""; const filter: any = { userId: session.id }; if (q) filter.$or = [{ quoteNumber: { $regex: q, $options: "i" } }, { customerName: { $regex: q, $options: "i" } }]; const quotes = await client.db().collection("Quote").find(filter).sort({ createdAt: -1 }).limit(300).toArray(); return NextResponse.json({ quotes }); }
  finally { await client.close(); }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request); if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json(); const customerName = String(body.customerName ?? "").trim(); if (!customerName) return NextResponse.json({ error: "El cliente es obligatorio" }, { status: 400 });
  const items: QuoteItem[] = Array.isArray(body.items) ? body.items.map((i: any) => ({ productId: String(i.productId ?? ""), name: String(i.name ?? "").trim(), quantity: Math.max(1, Number(i.quantity ?? 1)), unitPrice: Math.max(0, Number(i.unitPrice ?? 0)) })).filter((i: QuoteItem) => i.name) : [];
  if (!items.length) return NextResponse.json({ error: "Agrega al menos un producto o servicio" }, { status: 400 });
  const client = await db(); try { const quotes = client.db().collection<QuoteRecord>("Quote"); const now = new Date(); const count = await quotes.countDocuments({ userId: session.id }); const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0); const discount = Math.max(0, Number(body.discount ?? 0)); const total = Math.max(0, subtotal - discount); const customerId = typeof body.customerId === "string" && body.customerId.trim() ? body.customerId.trim() : null; const quote: QuoteRecord = { userId: session.id, quoteNumber: `COT-${String(count + 1).padStart(6, "0")}`, customerId, customerName, customerPhone: String(body.customerPhone ?? "").trim(), customerEmail: String(body.customerEmail ?? "").trim(), notes: String(body.notes ?? "").trim(), validUntil: body.validUntil ? new Date(body.validUntil) : null, status: "draft", items, subtotal, discount, total, createdAt: now, updatedAt: now, createdBy: session.id };
    const result = await quotes.insertOne(quote); await writeAuditLog({ userId: session.id, action: "QUOTE_CREATED", entityType: "Quote", entityId: String(result.insertedId), details: { quoteNumber: quote.quoteNumber, total: quote.total } }); return NextResponse.json({ ...quote, _id: result.insertedId }, { status: 201 });
  } finally { await client.close(); }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request); if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 }); const body = await request.json(); const id = String(body.id ?? ""); if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Cotización inválida" }, { status: 400 }); const client = await db(); try { const update: any = { updatedAt: new Date() }; if (body.status) update.status = String(body.status); if (body.notes !== undefined) update.notes = String(body.notes); if (body.validUntil !== undefined) update.validUntil = body.validUntil ? new Date(body.validUntil) : null; await client.db().collection("Quote").updateOne({ _id: new ObjectId(id), userId: session.id }, { $set: update }); return NextResponse.json(await client.db().collection("Quote").findOne({ _id: new ObjectId(id), userId: session.id })); } finally { await client.close(); }
}
