import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

const METHODS = ["cash", "card", "transfer", "other"] as const;
type PaymentResult = { amountPaid: number; amountDue: number; paymentStatus: "paid" | "partial"; invoiceStatus: "paid" | "sent"; now: Date };

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !["admin", "user", "retailer"].includes(session.role ?? "")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
  const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : "";
  const amount = Number(body.amount);
  if (!ObjectId.isValid(invoiceId)) return NextResponse.json({ error: "Factura inválida" }, { status: 400 });
  if (!METHODS.includes(paymentMethod as (typeof METHODS)[number])) return NextResponse.json({ error: "Método de pago inválido" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "El valor debe ser mayor que cero" }, { status: 400 });

  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  const mongoSession = client.startSession();
  try {
    const db = client.db();
    const transactionResult = await mongoSession.withTransaction(async () => {
      const invoice = await db.collection("Invoice").findOne({ _id: new ObjectId(invoiceId), userId: session.id }, { session: mongoSession });
      if (!invoice) throw Object.assign(new Error("Factura no encontrada"), { status: 404 });
      if (invoice.status === "cancelled") throw Object.assign(new Error("La factura está cancelada"), { status: 409 });

      const total = Number(invoice.total || 0);
      const paid = Number(invoice.amountPaid || 0);
      const due = Math.max(0, total - paid);
      if (due <= 0) throw Object.assign(new Error("La factura ya está pagada"), { status: 409 });
      if (amount > due + 0.01) throw Object.assign(new Error(`El máximo permitido es ${due.toFixed(2)}`), { status: 400 });

      const now = new Date();
      const newPaid = Math.min(total, paid + amount);
      const newDue = Math.max(0, total - newPaid);
      const paymentStatus: PaymentResult["paymentStatus"] = newDue <= 0.01 ? "paid" : "partial";
      const invoiceStatus: PaymentResult["invoiceStatus"] = paymentStatus === "paid" ? "paid" : "sent";
      const payment = { invoiceId, orderId: String(invoice.orderId), invoiceNumber: invoice.invoiceNumber, userId: session.id, recordedBy: session.id, amount, paymentMethod, status: "paid", createdAt: now };

      await db.collection("Payment").insertOne(payment, { session: mongoSession });
      const updated = await db.collection("Invoice").updateOne(
        { _id: invoice._id, userId: session.id, amountPaid: paid },
        { $set: { amountPaid: newPaid, amountDue: newDue, status: invoiceStatus, sentAt: invoice.sentAt ?? now, paidAt: paymentStatus === "paid" ? now : null, updatedAt: now } },
        { session: mongoSession },
      );
      if (updated.matchedCount !== 1) throw Object.assign(new Error("La factura cambió mientras se registraba el pago; vuelve a intentarlo"), { status: 409 });

      if (ObjectId.isValid(String(invoice.orderId))) {
        const orderUpdated = await db.collection("Order").updateOne(
          { _id: new ObjectId(String(invoice.orderId)), userId: session.id },
          { $set: { paymentStatus, updatedAt: now } },
          { session: mongoSession },
        );
        if (orderUpdated.matchedCount !== 1) throw Object.assign(new Error("No se pudo actualizar el estado de pago de la venta"), { status: 409 });
      }

      await db.collection("CashMovement").insertOne({ type: "income", source: "sale", amount, paymentMethod, orderId: String(invoice.orderId), orderNumber: invoice.invoiceNumber, userId: session.id, createdBy: session.id, description: `Pago factura ${invoice.invoiceNumber}`, status: "active", createdAt: now }, { session: mongoSession });
      return { amountPaid: newPaid, amountDue: newDue, paymentStatus, invoiceStatus, now } satisfies PaymentResult;
    });

    if (transactionResult === undefined) throw new Error("No se pudo completar la transacción de pago");
    const paymentResult = transactionResult as PaymentResult;

    await writeAuditLog({ userId: session.id, action: "INVOICE_PAYMENT_RECORDED", entityType: "Invoice", entityId: invoiceId, details: { amount, paymentMethod, newPaid: paymentResult.amountPaid, amountDue: paymentResult.amountDue, invoiceStatus: paymentResult.invoiceStatus }, userAgent: request.headers.get("user-agent"), ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip") });
    return NextResponse.json({ ok: true, amountPaid: paymentResult.amountPaid, amountDue: paymentResult.amountDue, paymentStatus: paymentResult.paymentStatus, invoiceStatus: paymentResult.invoiceStatus });
  } catch (error) {
    console.error("POST /api/cash/payments", error);
    const status = typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number" ? Number((error as { status: number }).status) : 500;
    const message = error instanceof Error ? error.message : "No se pudo registrar el pago";
    return NextResponse.json({ error: message }, { status });
  } finally {
    await mongoSession.endSession();
    await client.close();
  }
}
