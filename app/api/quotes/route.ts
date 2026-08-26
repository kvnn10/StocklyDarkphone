import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

const allowed = (session: any) => !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
async function db() { const client = new MongoClient(process.env.DATABASE_URL!); await client.connect(); return client; }

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request); if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const client = await db();
  try { const q = new URL(request.url).searchParams.get("search")?.trim() ?? ""; const filter: any = { userId: session.id }; if (q) filter.$or = [{ quoteNumber: { $regex: q, $options: "i" } }, { customerName: { $regex: q, $options: "i" } }]; const quotes = await client.db().collection("Quote").find(filter).sort({ createdAt: -1 }).limit(300).toArray(); return NextResponse.json({ quotes }); }
  finally { await client.close(); }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request); if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json(); const customerName = String(body.customerName ?? "").trim(); if (!customerName) return NextResponse.json({ error: "El cliente es obligatorio" }, { status: 400 });
  const items = Array.isArray(body.items) ? body.items.map((i: any) => ({ productId: String(i.productId ?? ""), name: String(i.name ?? "").trim(), quantity: Math.max(1, Number(i.quantity ?? 1)), unitPrice: Math.max(0, Number(i.unitPrice ?? 0)) })).filter((i: any) => i.name) : [];
  if (!items.length) return NextResponse.json({ error: "Agrega al menos un producto o servicio" }, { status: 400 });
  const client = await db(); try { const quotes = client.db().collection("Quote"); const now = new Date(); const count = await quotes.countDocuments({ userId: session.id }); const quote = { userId: session.id, quoteNumber: `COT-${String(count + 1).padStart(6, "0")}`, customerId: typeof body.customerId === "string" && ObjectId.isValid(body.customerId) ? body.customerId : null, customerName, customerPhone: String(body.customerPhone ?? "").trim(), customerEmail: String(body.customerEmail ?? "").trim(), notes: String(body.notes ?? "").trim(), validUntil: body.validUntil ? new Date(body.validUntil) : null, status: "draft", items, subtotal: items.reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0), discount: Math.max(0, Number(body.discount ?? 0)), createdAt: now, updatedAt: now, createdBy: session.id };
    quote.total = Math.max(0, quote.subtotal - quote.discount); const result = await quotes.insertOne(quote); await writeAuditLog({ userId: session.id, action: "QUOTE_CREATED", entityType: "Quote", entityId: String(result.insertedId), details: { quoteNumber: quote.quoteNumber, total: quote.total } }); return NextResponse.json({ ...quote, _id: result.insertedId }, { status: 201 });
  } finally { await client.close(); }
}

export async function PUT(request: NextRequest) {
  const session = await getSessionFromRequest(request); if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 }); const body = await request.json(); const id = String(body.id ?? ""); if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Cotización inválida" }, { status: 400 }); const client = await db(); try { const update: any = { updatedAt: new Date() }; if (body.status) update.status = String(body.status); if (body.notes !== undefined) update.notes = String(body.notes); if (body.validUntil !== undefined) update.validUntil = body.validUntil ? new Date(body.validUntil) : null; await client.db().collection("Quote").updateOne({ _id: new ObjectId(id), userId: session.id }, { $set: update }); return NextResponse.json(await client.db().collection("Quote").findOne({ _id: new ObjectId(id), userId: session.id })); } finally { await client.close(); }
}
