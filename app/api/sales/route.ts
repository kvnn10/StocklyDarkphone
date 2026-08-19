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

    // A POS sale belongs to one store owner. Mixed-owner carts are rejected
    // instead of silently assigning the sale to the wrong account.
    const ownerIds = [...new Set(products.map((product) => product.userId))];
    if (ownerIds.length !== 1) {
      return NextResponse.json(
        { error: "Todos los productos de una venta deben pertenecer a la misma tienda" },
        { status: 400 },
      );
    }

    const order = await createOrder(data, {
      storeOwnerUserId: ownerIds[0],
      createdByUserId: session.id,
      clientId: data.clientId ?? null,
    });

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("POST /api/sales", error);
    const message = error instanceof Error ? error.message : "No se pudo registrar la venta";
    const status = message.toLowerCase().includes("insufficient stock") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
