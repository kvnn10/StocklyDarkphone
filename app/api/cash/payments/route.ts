import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

const METHODS = ["cash", "card", "transfer", "other"] as const;

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !["admin", "user", "retailer"].includes(session.role ?? "")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
  const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : "";
  const amount = Number(body.amount);

  if (!ObjectId.isValid(invoiceId)) return NextResponse.json({ error: "Factura inválida" }, { status: 400 });
  if (!METHODS.includes(paymentMethod as (typeof METHODS)[number])) return NextResponse.json({ error: "Método de pago inválido" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El valor debe ser mayor que cero" }, { status: 400 });

  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  try {
    const db = client.db();
    const invoice = await db.collection("Invoice").findOne({ _id: new ObjectId(invoiceId), userId: session.id });
    if (!invoice) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    if (invoice.status === "cancelled") return NextResponse.json({ error: "La factura está cancelada" }, { status: 409 });

    const total = Number(invoice.total || 0);
    const paid = Number(invoice.amountPaid || 0);
    const due = Math.max(0, total - paid);
    if (due <= 0) return NextResponse.json({ error: "La factura ya está pagada" }, { status: 409 });
    if (amount > due + 0.01) return NextResponse.json({ error: `El máximo permitido es ${due.toFixed(2)}` }, { status: 400 });

    const now = new Date();
    const newPaid = Math.min(total, paid + amount);
    const newDue = Math.max(0, total - newPaid);
    const paymentStatus = newDue <= 0.01 ? "paid" : "partial";

    const payment = {
      orderId: String(invoice.orderId),
      orderNumber: invoice.invoiceNumber,
      userId: session.id,
      recordedBy: session.id,
      amount,
      paymentMethod,
      status: "paid",
      createdAt: now,
    };

    const paymentResult = await db.collection("SalePayment").insertOne(payment);
    try {
      await db.collection("Invoice").updateOne(
        { _id: invoice._id, userId: session.id, amountPaid: paid },
        { $set: { amountPaid: newPaid, amountDue: newDue, paidAt: paymentStatus === "paid" ? now : null, updatedAt: now }, },
      );
      await db.collection("Order").updateOne(
        { _id: new ObjectId(String(invoice.orderId)), userId: session.id },
        { $set: { paymentStatus, updatedAt: now } },
      );
      await db.collection("CashMovement").insertOne({
        type: "income",
        source: "sale",
        amount,
        paymentMethod,
        orderId: String(invoice.orderId),
        orderNumber: invoice.invoiceNumber,
        userId: session.id,
        createdBy: session.id,
        description: `Pago factura ${invoice.invoiceNumber}`,
        status: "active",
        createdAt: now,
      });
    } catch (error) {
      await db.collection("SalePayment").deleteOne({ _id: paymentResult.insertedId });
      throw error;
    }

    await writeAuditLog({
      userId: session.id,
      action: "INVOICE_PAYMENT_RECORDED",
      entityType: "Invoice",
      entityId: invoiceId,
      details: { amount, paymentMethod, previousPaid: paid, newPaid, amountDue: newDue },
      userAgent: request.headers.get("user-agent"),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip"),
    });

    return NextResponse.json({ ok: true, payment, amountPaid: newPaid, amountDue: newDue, paymentStatus });
  } catch (error) {
    console.error("POST /api/cash/payments", error);
    return NextResponse.json({ error: "No se pudo registrar el pago" }, { status: 500 });
  } finally {
    await client.close();
  }
}
