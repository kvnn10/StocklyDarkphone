import { NextRequest, NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { prisma } from "@/prisma/client";
import { authorizeRequest } from "@/lib/security/authorize";
import { fulfillPendingOrderLines } from "@/lib/products/order-stock-reservation";

const PAYMENT_METHODS = ["cash", "card", "transfer", "other"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && PAYMENT_METHODS.includes(value as PaymentMethod);
}

export async function POST(request: NextRequest) {
  try {
    const { session, response } = await authorizeRequest(request, "finance", "create_payment");
    if (response) return response;
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const body = await request.json();
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const paymentMethod = body.paymentMethod;
    if (!orderId || !ObjectId.isValid(orderId) || !isPaymentMethod(paymentMethod)) {
      return NextResponse.json({ error: "Venta o método de pago inválido" }, { status: 400 });
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    if (!["pending", "confirmed"].includes(order.status)) {
      return NextResponse.json({ error: "Esta venta no puede cobrarse en su estado actual" }, { status: 409 });
    }
    if (order.paymentStatus === "paid") {
      return NextResponse.json({ error: "Esta venta ya está pagada" }, { status: 409 });
    }
    if (order.createdBy !== session.id && order.userId !== session.id) {
      return NextResponse.json({ error: "No puedes cobrar esta venta" }, { status: 403 });
    }

    const client = new MongoClient(process.env.DATABASE_URL!);
    await client.connect();
    try {
      const db = client.db();
      const payments = db.collection("SalePayment");
      const existing = await payments.findOne({ orderId });
      if (existing) {
        return NextResponse.json({ error: "El pago de esta venta ya fue registrado" }, { status: 409 });
      }

      await fulfillPendingOrderLines(
        order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          warehouseId: item.warehouseId,
        })),
      );

      const now = new Date();
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: "confirmed",
          paymentStatus: "paid",
          updatedAt: now,
          updatedBy: session.id,
        },
      });

      const payment = {
        orderId,
        orderNumber: order.orderNumber,
        userId: order.userId,
        recordedBy: session.id,
        amount: order.total,
        paymentMethod,
        status: "paid",
        createdAt: now,
      };
      await payments.insertOne(payment);

      await db.collection("CashMovement").insertOne({
        type: "income",
        source: "sale",
        orderId,
        orderNumber: order.orderNumber,
        amount: order.total,
        paymentMethod,
        userId: order.userId,
        createdBy: session.id,
        description: `Venta ${order.orderNumber}`,
        createdAt: now,
      });

      return NextResponse.json({
        success: true,
        orderId,
        orderNumber: order.orderNumber,
        amount: order.total,
        paymentMethod,
      });
    } finally {
      await client.close();
    }
  } catch (error) {
    console.error("POST /api/sales/pay", error);
    return NextResponse.json({ error: "No se pudo completar el pago" }, { status: 500 });
  }
}
