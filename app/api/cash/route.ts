import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { getSessionFromRequest } from "@/utils/auth";
import { writeAuditLog } from "@/lib/audit/log";

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
    const db = client.db();
    const movements = await db.collection("CashMovement")
      .find({ userId: session.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    const saleOrderIds = movements
      .filter((m) => m.source === "sale" && typeof m.orderId === "string")
      .map((m) => m.orderId as string)
      .filter((id) => ObjectId.isValid(id));

    const cancelledOrderIds = new Set<string>();
    if (saleOrderIds.length > 0) {
      const orders = await db.collection("Order")
        .find(
          {
            _id: { $in: saleOrderIds.map((id) => new ObjectId(id)) },
            userId: session.id,
            $or: [{ status: "cancelled" }, { paymentStatus: "refunded" }],
          },
          { projection: { _id: 1 } },
        )
        .toArray();
      for (const order of orders) cancelledOrderIds.add(String(order._id));
    }

    const normalizedMovements = movements.map((movement) => {
      const isCancelledSale =
        movement.source === "sale" &&
        typeof movement.orderId === "string" &&
        cancelledOrderIds.has(movement.orderId);

      if (!isCancelledSale || movement.status === "voided") return movement;

      return {
        ...movement,
        status: "voided",
        voidedAt: movement.voidedAt ?? new Date(),
        voidReason: "Venta cancelada o reembolsada",
        automaticallyVoided: true,
      };
    });

    const activeMovements = normalizedMovements.filter((m) => m.status !== "voided");
    const income = activeMovements
      .filter((m) => m.type === "income")
      .reduce((sum, m) => sum + Number(m.amount || 0), 0);
    const expense = activeMovements
      .filter((m) => m.type === "expense")
      .reduce((sum, m) => sum + Number(m.amount || 0), 0);
    const refunds = activeMovements
      .filter((m) => m.source === "refund")
      .reduce((sum, m) => sum + Number(m.amount || 0), 0);

    return NextResponse.json({
      movements: normalizedMovements,
      summary: { income, expense, refunds, balance: income - expense },
    });
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
      const db = client.db();
      const collection = db.collection("CashMovement");

      if (orderId && ObjectId.isValid(orderId)) {
        const order = await db.collection("Order").findOne({
          _id: new ObjectId(orderId),
          userId: session.id,
        });

        if (!order) {
          return NextResponse.json({ error: "Venta no encontrada o no autorizada" }, { status: 404 });
        }
        if (order.status === "cancelled" || order.paymentStatus === "refunded") {
          return NextResponse.json({ error: "No se puede registrar Caja para una venta cancelada o reembolsada" }, { status: 409 });
        }
      }

      if (orderId) {
        const existing = await collection.findOne({
          userId: session.id,
          orderId,
          source: "sale",
          status: { $ne: "voided" },
        });
        if (existing) return NextResponse.json(existing, { status: 200 });
      }

      const description = typeof body.description === "string"
        ? body.description.trim()
        : orderId ? "Venta" : "Movimiento manual";
      const movement = {
        type: body.type,
        source,
        ...(orderId ? { orderId } : {}),
        amount,
        paymentMethod: body.paymentMethod,
        userId: session.id,
        createdBy: session.id,
        description,
        status: "active",
        createdAt: new Date(),
      };
      const result = await collection.insertOne(movement);
      const savedMovement = { ...movement, _id: result.insertedId };

      await writeAuditLog({
        userId: session.id,
        action: "CASH_MOVEMENT_CREATED",
        entityType: "CashMovement",
        entityId: String(result.insertedId),
        details: {
          type: movement.type,
          source: movement.source,
          amount: movement.amount,
          paymentMethod: movement.paymentMethod,
          orderId: movement.orderId ?? null,
          description: movement.description,
        },
        userAgent: request.headers.get("user-agent"),
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip"),
      });

      return NextResponse.json(savedMovement, { status: 201 });
    } finally {
      await client.close();
    }
  } catch (error) {
    console.error("POST /api/cash", error);
    return NextResponse.json({ error: "No se pudo registrar el movimiento" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !["admin", "user", "retailer"].includes(session.role ?? "")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Movimiento inválido" }, { status: 400 });
    }

    const client = new MongoClient(process.env.DATABASE_URL!);
    await client.connect();
    try {
      const collection = client.db().collection("CashMovement");
      const movement = await collection.findOne({ _id: new ObjectId(id), userId: session.id });

      if (!movement) return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
      if (movement.status === "voided") {
        return NextResponse.json({ error: "El movimiento ya está anulado" }, { status: 409 });
      }

      const voidReason = typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : "Movimiento anulado manualmente";

      await collection.updateOne(
        { _id: movement._id, userId: session.id, status: { $ne: "voided" } },
        {
          $set: {
            status: "voided",
            voidedAt: new Date(),
            voidedBy: session.id,
            voidReason,
          },
        },
      );

      await writeAuditLog({
        userId: session.id,
        action: "CASH_MOVEMENT_VOIDED",
        entityType: "CashMovement",
        entityId: id,
        details: {
          type: movement.type,
          source: movement.source,
          amount: Number(movement.amount || 0),
          paymentMethod: movement.paymentMethod,
          orderId: movement.orderId ?? null,
          reason: voidReason,
        },
        userAgent: request.headers.get("user-agent"),
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip"),
      });

      return NextResponse.json({ ok: true, message: "Movimiento anulado correctamente" });
    } finally {
      await client.close();
    }
  } catch (error) {
    console.error("DELETE /api/cash", error);
    return NextResponse.json({ error: "No se pudo anular el movimiento" }, { status: 500 });
  }
}
