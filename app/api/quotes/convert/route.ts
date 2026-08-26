import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
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
  try {
    const quote = await client.db().collection("Quote").findOne({ _id: new ObjectId(id), userId: session.id });
    if (!quote) return NextResponse.json({ error: "Cotización no encontrada" }, { status: 404 });
    if (quote.status !== "accepted") return NextResponse.json({ error: "La cotización debe estar aceptada antes de convertirla" }, { status: 409 });
    if (quote.convertedOrderId) return NextResponse.json({ error: "La cotización ya fue convertida", orderId: quote.convertedOrderId, invoiceId: quote.convertedInvoiceId }, { status: 409 });

    const items = (Array.isArray(quote.items) ? quote.items : []) as QuoteItem[];
    if (!items.length || items.some((item) => !item.productId)) return NextResponse.json({ error: "La cotización contiene líneas sin producto de inventario; no se puede convertir automáticamente" }, { status: 400 });

    // Never silently change a customer's accepted price. The order engine uses the
    // current catalog price, so conversion is allowed only when it still matches.
    const products = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } }, select: { id: true, price: true } });
    const productMap = new Map(products.map((p) => [p.id, Number(p.price)]));
    const priceMismatch = items.find((item) => !productMap.has(item.productId) || Math.abs(Number(item.unitPrice) - Number(productMap.get(item.productId))) > 0.0001);
    if (priceMismatch) return NextResponse.json({ error: `El precio de ${priceMismatch.name} cambió desde la cotización. Actualiza la cotización antes de convertirla.` }, { status: 409 });

    const orderData: CreateOrderInput = {
      clientId: typeof quote.customerId === "string" ? quote.customerId : undefined,
      items: items.map((item) => ({ productId: item.productId, quantity: Math.max(1, Number(item.quantity)) })),
      discount: Math.max(0, Number(quote.discount ?? 0)),
      notes: `Convertida desde ${String(quote.quoteNumber)}${quote.notes ? ` — ${String(quote.notes)}` : ""}`,
    };

    const order = await createOrder(orderData, { storeOwnerUserId: session.id, createdByUserId: session.id, clientId: orderData.clientId ?? null });
    let invoice;
    try {
      invoice = await createInvoice({ orderId: order.id, dueDate: new Date().toISOString(), discount: order.discount ?? 0, notes: `Origen: ${String(quote.quoteNumber)}` }, session.id);
    } catch (error) {
      // createInvoice's normal lifecycle rollback handles pending stock when needed;
      // leave the error visible rather than marking the quote as converted.
      throw error;
    }

    await client.db().collection("Quote").updateOne(
      { _id: new ObjectId(id), userId: session.id, status: "accepted" },
      { $set: { status: "converted", convertedOrderId: order.id, convertedOrderNumber: order.orderNumber, convertedInvoiceId: invoice.id, convertedInvoiceNumber: invoice.invoiceNumber, convertedAt: new Date(), updatedAt: new Date() } },
    );
    await writeAuditLog({ userId: session.id, action: "QUOTE_CONVERTED", entityType: "Quote", entityId: id, details: { quoteNumber: quote.quoteNumber, orderId: order.id, orderNumber: order.orderNumber, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber } });

    return NextResponse.json({ ok: true, quoteId: id, quoteNumber: quote.quoteNumber, orderId: order.id, orderNumber: order.orderNumber, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo convertir la cotización" }, { status: 500 });
  } finally { await client.close(); }
}
