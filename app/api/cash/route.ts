import { NextRequest, NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";

const TYPES = ["income", "expense"] as const;
const METHODS = ["cash", "card", "transfer", "other"] as const;

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !["admin", "user", "retailer"].includes(session.role ?? "")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const client = new MongoClient(process.env.DATABASE_URL!);
  await client.connect();
  try {
    const movements = await client.db().collection("CashMovement")
      .find({ userId: session.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    const income = movements.filter((m) => m.type === "income").reduce((sum, m) => sum + Number(m.amount || 0), 0);
    const expense = movements.filter((m) => m.type === "expense").reduce((sum, m) => sum + Number(m.amount || 0), 0);
    return NextResponse.json({ movements, summary: { income, expense, balance: income - expense } });
  } finally {
    await client.close();
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !["admin", "user", "retailer"].includes(session.role ?? "")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!TYPES.includes(body.type) || !METHODS.includes(body.paymentMethod)) {
      return NextResponse.json({ error: "Tipo o método de pago inválido" }, { status: 400 });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "El valor debe ser mayor que cero" }, { status: 400 });
    }

    const orderId = typeof body.orderId === "string" && body.orderId.trim() ? body.orderId.trim() : null;
    const source = orderId ? "sale" : "manual";

    const client = new MongoClient(process.env.DATABASE_URL!);
    await client.connect();
    try {
      const collection = client.db().collection("CashMovement");

      // A sale may be retried by the UI or API. Reuse the existing movement
      // instead of creating a duplicate income for the same order.
      if (orderId) {
        const existing = await collection.findOne({ userId: session.id, orderId, source: "sale" });
        if (existing) {
          return NextResponse.json(existing, { status: 200 });
        }
      }

      const movement = {
        type: body.type,
        source,
        ...(orderId ? { orderId } : {}),
        amount,
        paymentMethod: body.paymentMethod,
        userId: session.id,
        createdBy: session.id,
        description: typeof body.description === "string" ? body.description.trim() : orderId ? "Venta" : "Movimiento manual",
        createdAt: new Date(),
      };
      const result = await collection.insertOne(movement);
      return NextResponse.json({ ...movement, _id: result.insertedId }, { status: 201 });
    } finally {
      await client.close();
    }
  } catch (error) {
    console.error("POST /api/cash", error);
    return NextResponse.json({ error: "No se pudo registrar el movimiento" }, { status: 500 });
  }
}
