import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { createOrder } from "@/prisma/order";
import { createOrderSchema } from "@/lib/validations";
import { prisma } from "@/prisma/client";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos de venta inválidos", details: parsed.error.flatten() }, { status: 400 });
    }

    const data = parsed.data;
    const productIds = data.items.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: { id: true, name: true, sku: true, price: true, quantity: true },
    });
    const productMap = new Map(products.map((product) => [product.id, product]));

    for (const item of data.items) {
      const product = productMap.get(item.productId);
      if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 400 });
      if (Number(product.quantity) < item.quantity) {
        return NextResponse.json({ error: `Stock insuficiente para ${product.name}` }, { status: 409 });
      }
    }

    const order = await createOrder({
      ...data,
      userId: session.id,
      createdBy: session.id,
    } as never);

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("POST /api/sales", error);
    return NextResponse.json({ error: "No se pudo registrar la venta" }, { status: 500 });
  }
}
