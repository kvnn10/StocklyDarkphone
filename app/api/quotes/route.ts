import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

const allowed = (session: any) => !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
const STATUSES = ["draft", "sent", "accepted", "rejected", "expired", "converted"] as const;
type QuoteStatus = typeof STATUSES[number];
async function db() { const client = new MongoClient(process.env.DATABASE_URL!); await client.connect(); return client; }

type QuoteItem = { productId: string; name: string; quantity: number; unitPrice: number };
type QuoteRecord = { _id?: ObjectId; userId: string; quoteNumber: string; customerId: string | null; customerName: string; customerPhone: string; customerEmail: string; notes: string; validUntil: Date | null; status: QuoteStatus; items: QuoteItem[]; subtotal: number; discount: number; total: number; createdAt: Date; updatedAt: Date; createdBy: string; convertedOrderId?: string; convertedOrderNumber?: string; convertedInvoiceId?: string; convertedInvoiceNumber?: string; convertedAt?: Date };

const normalizeExpiration = (quote: QuoteRecord, now = new Date()): QuoteRecord => quote.status !== "converted" && quote.status !== "rejected" && quote.validUntil && quote.validUntil < now ? { ...quote, status: "expired", updatedAt: now } : quote;

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request); if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const client = await db();
  try {
    const q = new URL(request.url).searchParams.get("search")?.trim() ?? "";
    const filter: any = { userId: session.id }; if (q) filter.$or = [{ quoteNumber: { $regex: q, $options: "i" } }, { customerName: { $regex: q, $options: "i" } }];
    const collection = client.db().collection<QuoteRecord>("Quote"); const quotes = await collection.find(filter).sort({ createdAt: -1 }).limit(300).toArray(); const now = new Date();
    const expiredIds = quotes.filter(qt => normalizeExpiration(qt, now).status === "expired" && qt.status !== "expired").map(qt => qt._id).filter((id): id is ObjectId => !!id);
    if (expiredIds.length) await collection.updateMany({ _id: { $in: expiredIds }, userId: session.id }, { $set: { status: "expired", updatedAt: now } });
    return NextResponse.json({ quotes: quotes.map(qt => normalizeExpiration(qt, now)) });
  } finally { await client.close(); }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request); if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json(); const customerName = String(body.customerName ?? "").trim(); if (!customerName) return NextResponse.json({ error: "El cliente es obligatorio" }, { status: 400 });
  const items: QuoteItem[] = Array.isArray(body.items) ? body.items.map((i: any) => ({ productId: String(i.productId ?? ""), name: String(i.name ?? "").trim(), quantity: Math.max(1, Number(i.quantity ?? 1)), unitPrice: Math.max(0, Number(i.unitPrice ?? 0)) })).filter((i: QuoteItem) => i.name) : [];
  if (!items.length) return NextResponse.json({ error: "Agrega al menos un producto o servicio" }, { status: 400 });
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0); const rawDiscount = Number(body.discount ?? 0); if (!Number.isFinite(rawDiscount) || rawDiscount < 0) return NextResponse.json({ error: "El descuento no es válido" }, { status: 400 }); const discount = Math.min(subtotal, rawDiscount); const total = Math.max(0, subtotal - discount);
  const validUntil = body.validUntil ? new Date(body.validUntil) : null; if (validUntil && Number.isNaN(validUntil.getTime())) return NextResponse.json({ error: "La fecha de vigencia no es válida" }, { status: 400 });
  const client = await db(); try { const quotes = client.db().collection<QuoteRecord>("Quote"); const now = new Date(); const count = await quotes.countDocuments({ userId: session.id }); const customerId = typeof body.customerId === "string" && body.customerId.trim() ? body.customerId.trim() : null; const quote: QuoteRecord = { userId: session.id, quoteNumber: `COT-${String(count + 1).padStart(6, "0")}`, customerId, customerName, customerPhone: String(body.customerPhone ?? "").trim(), customerEmail: String(body.customerEmail ?? "").trim(), notes: String(body.notes ?? "").trim(), validUntil, status: "draft", items, subtotal, discount, total, createdAt: now, updatedAt: now, createdBy: session.id };
    const result = await quotes.insertOne(quote); await writeAuditLog({ userId: session.id, action: "QUOTE_CREATED", entityType: "Quote", entityId: String(result.insertedId), details: { quoteNumber: quote.quoteNumber, total: quote.total } }); return NextResponse.json({ ...quote, _id: result.insertedId }, { status: 201 });
  } finally { await client.close(); }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request); if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 }); const body = await request.json(); const id = String(body.id ?? ""); if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Cotización inválida" }, { status: 400 }); const nextStatus = body.status === undefined ? null : String(body.status) as QuoteStatus; if (nextStatus && !STATUSES.includes(nextStatus)) return NextResponse.json({ error: "Estado de cotización inválido" }, { status: 400 }); const client = await db(); try { const quotes = client.db().collection<QuoteRecord>("Quote"); const current = await quotes.findOne({ _id: new ObjectId(id), userId: session.id }); if (!current) return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 }); const normalized = normalizeExpiration(current); if (normalized.status === "expired" && nextStatus && nextStatus !== "expired" && body.validUntil === undefined) return NextResponse.json({ error: "La cotización está vencida; actualiza su vigencia antes de continuar" }, { status: 409 }); if (current.status === "converted" || current.status === "rejected") return NextResponse.json({ error: "La cotización ya está cerrada y no puede modificarse" }, { status: 409 }); const update: Partial<QuoteRecord> = { updatedAt: new Date() }; if (nextStatus) update.status = nextStatus; if (body.notes !== undefined) update.notes = String(body.notes); if (body.validUntil !== undefined) { const date = body.validUntil ? new Date(body.validUntil) : null; if (date && Number.isNaN(date.getTime())) return NextResponse.json({ error: "La fecha de vigencia no es válida" }, { status: 400 }); update.validUntil = date; if (normalized.status === "expired" && date && date >= new Date()) update.status = nextStatus && nextStatus !== "expired" ? nextStatus : "draft"; } await quotes.updateOne({ _id: new ObjectId(id), userId: session.id }, { $set: update }); return NextResponse.json(await quotes.findOne({ _id: new ObjectId(id), userId: session.id })); } finally { await client.close(); }
}
