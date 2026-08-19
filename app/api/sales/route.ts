import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { createOrder } from "@/prisma/order";
import { createOrderSchema } from "@/lib/validations";
import { prisma } from "@/prisma/client";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!["admin", "user", "retailer"].includes(session.role ?? "")) {
      return NextResponse.json({ error: "No autorizado para registrar ventas" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Datos de venta inválidos", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const data = parsed.data;
    const productIds = data.items.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: { id: true, name: true, quantity: true, userId: true },
    });
    const productMap = new Map(products.map((product) => [product.id, product]));

    for (const item of data.items) {
      const product = productMap.get(item.productId);
      if (!product) {
        return NextResponse.json({ error: "Producto no encontrado" }, { status: 400 });
      }
      if (Number(product.quantity) < item.quantity) {
        return NextResponse.json(
          { error: `Stock insuficiente para ${product.name}` },
          { status: 409 },
        );
      }
    }

    const ownerIds = [...new Set(products.map((product) => product.userId))];
    const storeOwnerUserId = ownerIds[0];
    if (!storeOwnerUserId || ownerIds.length !== 1) {
      return NextResponse.json(
        { error: "Todos los productos de una venta deben pertenecer a la misma tienda" },
        { status: 400 },
      );
    }

    // A paid POS sale must explicitly provide a payment method. Existing callers
    // without payment data continue to create unpaid orders as before.
    if (data.paymentStatus === "paid" && !data.paymentMethod) {
      return NextResponse.json(
        { error: "El método de pago es obligatorio para una venta pagada" },
        { status: 400 },
      );
    }

    const order = await createOrder(data, {
      storeOwnerUserId,
      createdByUserId: session.id,
      clientId: data.clientId ?? null,
    });

    if (data.paymentStatus === "paid" && data.paymentMethod) {
      // The unique SalePayment(orderId) plus the order-linked cash movement make
      // payment registration idempotent if the request is retried.
      const payment = await prisma.salePayment.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId: storeOwnerUserId,
          recordedBy: session.id,
          amount: Number(order.total),
          paymentMethod: data.paymentMethod,
          status: "paid",
        },
        update: {
          amount: Number(order.total),
          paymentMethod: data.paymentMethod,
          status: "paid",
          recordedBy: session.id,
        },
      });

      await prisma.cashMovement.upsert({
        where: { id: payment.id },
        create: {
          type: "income",
          source: "sale",
          amount: Number(order.total),
          paymentMethod: data.paymentMethod,
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId: storeOwnerUserId,
          createdBy: session.id,
          description: `Venta ${order.orderNumber}`,
        },
        update: {
          amount: Number(order.total),
          paymentMethod: data.paymentMethod,
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId: storeOwnerUserId,
          createdBy: session.id,
          description: `Venta ${order.orderNumber}`,
        },
      });

      const paidOrder = await prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: "paid" },
        include: { items: true },
      });

      return NextResponse.json(paidOrder, { status: 201 });
    }

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("POST /api/sales", error);
    const message = error instanceof Error ? error.message : "No se pudo registrar la venta";
    const status = message.toLowerCase().includes("insufficient stock") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
