import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { findAccessibleProduct } from "@/lib/products/stock-product-access";
import { scheduleInvalidateStockAllocationCaches } from "@/lib/cache";

const countSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  countedQuantity: z.number().int().min(0),
  reason: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

function serialize(value: { productId: string; warehouseId: string; countedQuantity: bigint; previousStock: bigint; newStock: bigint; delta: bigint; movementId: string; createdAt: Date }) {
  return {
    ...value,
    countedQuantity: value.countedQuantity.toString(),
    previousStock: value.previousStock.toString(),
    newStock: value.newStock.toString(),
    delta: value.delta.toString(),
  };
}

export async function GET(request: NextRequest) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.role ?? "client") === "client") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  const warehouseId = searchParams.get("warehouseId");
  const limitValue = Number(searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 200) : 50;

  const movements = await prisma.inventoryMovement.findMany({
    where: {
      userId: session.id,
      type: "adjustment",
      reason: { contains: "Inventario físico" },
      ...(productId ? { productId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(movements.map((movement) => ({
    id: movement.id,
    productId: movement.productId,
    warehouseId: movement.warehouseId,
    countedQuantity: movement.newStock.toString(),
    previousStock: movement.previousStock.toString(),
    delta: movement.quantity.toString(),
    newStock: movement.newStock.toString(),
    reason: movement.reason,
    notes: movement.notes,
    createdAt: movement.createdAt,
  })));
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
  if (rateLimitResponse) return rateLimitResponse;
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.role ?? "client") === "client") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = countSchema.safeParse(body);
  if (!validation.success) return NextResponse.json({ error: "Invalid request body", details: validation.error.errors }, { status: 400 });
  const data = validation.data;

  const product = await findAccessibleProduct({ id: session.id, role: session.role }, data.productId, "write");
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  const warehouse = await prisma.warehouse.findFirst({ where: { id: data.warehouseId, userId: session.id, status: true }, select: { id: true, name: true } });
  if (!warehouse) return NextResponse.json({ error: "Warehouse not found or inactive" }, { status: 404 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: data.productId, warehouseId: data.warehouseId } } });
      const previousStock = allocation?.quantity ?? 0n;
      const reserved = allocation?.reservedQuantity ?? 0n;
      const countedQuantity = BigInt(data.countedQuantity);
      if (countedQuantity < reserved) throw new Error(`El conteo no puede quedar por debajo del stock reservado (${reserved})`);
      const delta = countedQuantity - previousStock;
      if (delta === 0n) throw new Error("El conteo coincide con el stock actual; no hay ajuste que registrar");
      const newStock = countedQuantity;

      if (allocation) {
        await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: newStock, updatedAt: new Date() } });
      } else {
        await tx.stockAllocation.create({ data: { productId: data.productId, warehouseId: data.warehouseId, userId: session.id, quantity: newStock, reservedQuantity: 0n, createdAt: new Date() } });
      }

      const allocations = await tx.stockAllocation.findMany({ where: { productId: data.productId }, select: { quantity: true } });
      const totalStock = allocations.reduce((sum, row) => sum + row.quantity, 0n);
      await tx.product.update({ where: { id: data.productId }, data: { quantity: totalStock, updatedAt: new Date(), updatedBy: session.id } });

      const movement = await tx.inventoryMovement.create({
        data: {
          productId: data.productId,
          warehouseId: data.warehouseId,
          userId: session.id,
          type: "adjustment",
          quantity: delta,
          previousStock,
          newStock,
          reason: `Inventario físico${data.reason ? ` · ${data.reason}` : ""}`,
          notes: data.notes ?? null,
          createdAt: new Date(),
        },
      });

      return { movement, countedQuantity, previousStock, newStock, delta };
    });

    await writeAuditLog({
      userId: session.id,
      action: "INVENTORY_PHYSICAL_COUNT",
      entityType: "Product",
      entityId: product.id,
      details: { productId: product.id, warehouseId: warehouse.id, warehouseName: warehouse.name, previousStock: result.previousStock.toString(), countedQuantity: result.countedQuantity.toString(), delta: result.delta.toString(), movementId: result.movement.id },
    });
    await scheduleInvalidateStockAllocationCaches();

    return NextResponse.json(serialize({ productId: product.id, warehouseId: warehouse.id, countedQuantity: result.countedQuantity, previousStock: result.previousStock, newStock: result.newStock, delta: result.delta, movementId: result.movement.id, createdAt: result.movement.createdAt }), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo registrar el conteo";
    if (message.includes("reservado") || message.includes("coincide")) return NextResponse.json({ error: message }, { status: 409 });
    console.error("POST /api/inventory-counts", error);
    return NextResponse.json({ error: "No se pudo registrar el conteo físico" }, { status: 500 });
  }
}
