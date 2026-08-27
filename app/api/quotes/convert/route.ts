import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { randomUUID } from "crypto";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/prisma/client";
import { createOrder } from "@/prisma/order";
import { createInvoice } from "@/prisma/invoice";
import type { CreateOrderInput } from "@/types/order";

const allowed = (session: any) => !!session && ["admin", "user", "retailer"].includes(session.role ?? "");
async function db() { const client = new MongoClient(process.env.DATABASE_URL!); await client.connect(); return client; }

type QuoteItem = { productId: string; name: string; quantity: number; unitPrice: number };

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !allowed(session)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const id = String(body.id ?? "");
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Cotización inválida" }, { status: 400 });

  const client = await db();
  const conversionToken = randomUUID();
  let claimed = false;
  try {
    const quotes = client.db().collection("Quote");
    // Atomically claim the quote before creating the order. This prevents two
    // simultaneous requests from creating two orders/invoices from one quote.
    const claim = await quotes.findOneAndUpdate(
      { _id: new ObjectId(id), userId: session.id, status: "accepted", convertedOrderId: { $exists: false }, conversionToken: { $exists: false } },
      { $set: { conversionToken, conversionStartedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    const quote = claim?.value;
    if (!quote) {
      const existing = await quotes.findOne({ _id: new ObjectId(id), userId: session.id });
      if (!existing) return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 });
      if (existing.convertedOrderId) return NextResponse.json({ error: "La cotización ya fue convertida", orderId: existing.convertedOrderId, invoiceId: existing.convertedInvoiceId }, { status: 409 });
      if (existing.conversionToken) return NextResponse.json({ error: "La cotización ya está siendo convertida; espera un momento y vuelve a consultar." }, { status: 409 });
      return NextResponse.json({ error: "La cotización debe estar aceptada antes de convertirla" }, { status: 409 });
    }
    claimed = true;

    const items = (Array.isArray(quote.items) ? quote.items : []) as QuoteItem[];
    if (!items.length || items.some((item) => !item.productId)) return NextResponse.json({ error: "La cotización contiene líneas sin producto de inventario; no se puede convertir automáticamente" }, { status: 400 });

    // Never silently change a customer's accepted price. The order engine uses the
    // current catalog price, so conversion is allowed only when it still matches.
    const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } }, select: { id: true, price: true } });
    const productMap = new Map(products.map((p) => [p.id, Number(p.price)]));
    const priceMismatch = items.find((item) => !productMap.has(item.productId) || Math.abs(Number(item.unitPrice) - Number(productMap.get(item.productId))) > 0.0001);
    if (priceMismatch) throw Object.assign(new Error(`El precio de ${priceMismatch.name} cambió desde la cotización. Actualiza la cotización antes de convertirla.`), { status: 409 });

    const orderData: CreateOrderInput = {
      clientId: typeof quote.customerId === "string" ? quote.customerId : undefined,
      items: items.map((item) => ({ productId: item.productId, quantity: Math.max(1, Number(item.quantity)) })),
      discount: Math.max(0, Number(quote.discount ?? 0)),
      notes: `Convertida desde ${String(quote.quoteNumber)}${quote.notes ? ` — ${String(quote.notes)}` : ""}`,
    };

    let order;
    try {
      order = await createOrder(orderData, { storeOwnerUserId: session.id, createdByUserId: session.id, clientId: orderData.clientId ?? null });
      const invoice = await createInvoice({ orderId: order.id, dueDate: new Date().toISOString(), discount: order.discount ?? 0, notes: `Origen: ${String(quote.quoteNumber)}` }, session.id);

      const finalized = await quotes.updateOne(
        { _id: new ObjectId(id), userId: session.id, status: "accepted", conversionToken, convertedOrderId: { $exists: false } },
        { $set: { status: "converted", convertedOrderId: order.id, convertedOrderNumber: order.orderNumber, convertedInvoiceId: invoice.id, convertedInvoiceNumber: invoice.invoiceNumber, convertedAt: new Date(), updatedAt: new Date() }, $unset: { conversionToken: "", conversionStartedAt: "" } },
      );
      if (finalized.matchedCount !== 1) throw new Error("No se pudo finalizar la conversión de la cotización de forma segura");

      await writeAuditLog({ userId: session.id, action: "QUOTE_CONVERTED", entityType: "Quote", entityId: id, details: { quoteNumber: quote.quoteNumber, orderId: order.id, orderNumber: order.orderNumber, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber } });
      return NextResponse.json({ ok: true, quoteId: id, quoteNumber: quote.quoteNumber, orderId: order.id, orderNumber: order.orderNumber, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber }, { status: 201 });
    } catch (error) {
      // If conversion fails before the quote is finalized, release the claim so the
      // user can retry. The order engine remains the source of truth for stock.
      await quotes.updateOne({ _id: new ObjectId(id), userId: session.id, status: "accepted", conversionToken }, { $unset: { conversionToken: "", conversionStartedAt: "" }, $set: { updatedAt: new Date() } });
      throw error;
    }
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number" ? Number((error as { status: number }).status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo convertir la cotización" }, { status });
  } finally { await client.close(); }
}
