import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { financeDb, jsonSafe, oid, validObjectId } from "@/lib/finance/financial-ledger";

const ROLES = ["admin", "user", "retailer"];

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const clientId = params.get("clientId");
  if (!clientId || !validObjectId(clientId)) return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });

  try {
    const db = await financeDb();
    const receivables = await db.collection("AccountReceivable")
      .find({ userId: oid(session.id), clientId: oid(clientId) })
      .sort({ createdAt: 1 })
      .limit(1000)
      .toArray();

    const ids = receivables.map((row: any) => row._id);
    const payments = ids.length
      ? await db.collection("AccountReceivablePayment").find({ userId: oid(session.id), receivableId: { $in: ids } }).sort({ createdAt: 1 }).toArray()
      : [];

    const paymentMap = new Map<string, any[]>();
    for (const payment of payments) {
      const key = payment.receivableId.toHexString();
      const list = paymentMap.get(key) ?? [];
      list.push(payment);
      paymentMap.set(key, list);
    }

    const entries = receivables.flatMap((row: any) => {
      const key = row._id.toHexString();
      const sale = {
        type: "sale",
        date: row.createdAt,
        document: row.orderNumber,
        description: `Venta ${row.orderNumber}`,
        debit: Number(row.originalAmount ?? 0),
        credit: 0,
        balance: Number(row.originalAmount ?? 0),
        receivableId: key,
      };
      const rowPayments = paymentMap.get(key) ?? [];
      const movements = rowPayments.map((payment: any) => ({
        type: "payment",
        date: payment.createdAt,
        document: payment._id.toHexString(),
        description: `Abono ${row.orderNumber}`,
        debit: 0,
        credit: Number(payment.amount ?? 0),
        balance: 0,
        paymentMethod: payment.paymentMethod,
        receivableId: key,
      }));
      return [sale, ...movements];
    });

    let balance = 0;
    for (const entry of entries) {
      balance = Math.max(0, balance + entry.debit - entry.credit);
      entry.balance = Math.round((balance + Number.EPSILON) * 100) / 100;
    }

    const totalInvoiced = receivables.reduce((sum: number, row: any) => sum + Number(row.originalAmount ?? 0), 0);
    const totalPaid = payments.reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
    const totalDue = Math.max(0, totalInvoiced - totalPaid);
    const client = await db.collection("User").findOne({ _id: oid(clientId), role: "client" }, { projection: { password: 0 } });

    return NextResponse.json(jsonSafe({
      client: client ? { id: client._id, name: client.name, email: client.email, phone: client.phone, document: client.document } : { id: clientId },
      summary: { totalInvoiced, totalPaid, totalDue },
      entries,
    }));
  } catch (error) {
    console.error("GET /api/finance/receivables/statement", error);
    return NextResponse.json({ error: "No se pudo generar el estado de cuenta" }, { status: 500 });
  }
}
