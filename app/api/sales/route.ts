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
    const productSkus = data.items
      .map((item) => item.sku)
      .filter((sku): sku is string => Boolean(sku));

    const products = await prisma.product.findMany({
      where: {
        userId: session.id,
        OR: [
          { id: { in: productIds } },
          ...(productSkus.length ? [{ sku: { in: productSkus } }] : []),
        ],
      },
      select: { id: true, name: true, sku: true, quantity: true, userId: true },
    });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const productSkuMap = new Map(products.map((product) => [product.sku, product]));

    const resolvedItems = data.items.map((item) => {
      const product =
        productMap.get(item.productId) ??
        (item.sku ? productSkuMap.get(item.sku) : undefined);
      return product ? { ...item, productId: product.id } : null;
    });

    for (let index = 0; index < data.items.length; index += 1) {
      const item = data.items[index];
      if (!item) {
        return NextResponse.json({ error: "Ítem de venta inválido" }, { status: 400 });
      }

      const resolvedItem = resolvedItems[index];
      const product = resolvedItem
        ? productMap.get(resolvedItem.productId)
        : undefined;

      if (!product) {
        return NextResponse.json(
          { error: `Producto no encontrado${item.sku ? `: ${item.sku}` : ""}` },
          { status: 400 },
        );
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

    if (data.paymentStatus === "paid" && !data.paymentMethod) {
      return NextResponse.json(
        { error: "El método de pago es obligatorio para una venta pagada" },
        { status: 400 },
      );
    }

    const normalizedData = {
      ...data,
      items: resolvedItems.map((item) => {
        if (!item) throw new Error("Producto no encontrado");
        return {
          productId: item.productId,
          quantity: item.quantity,
          ...(item.warehouseId ? { warehouseId: item.warehouseId } : {}),
        };
      }),
    };

    const order = await createOrder(normalizedData, {
      storeOwnerUserId,
      createdByUserId: session.id,
      clientId: data.clientId ?? null,
    });

    if (data.paymentStatus === "paid" && data.paymentMethod) {
      const payment = await prisma.salePayment.create({
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          userId: storeOwnerUserId,
          recordedBy: session.id,
          amount: Number(order.total),
          paymentMethod: data.paymentMethod,
          status: "paid",
        },
      });

      await prisma.cashMovement.create({
        data: {
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