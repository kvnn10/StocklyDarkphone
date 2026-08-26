/**
 * Inventory movement API.
 * POST creates an atomic stock movement and updates the warehouse allocation.
 * GET returns the authenticated user's movement history.
 * DELETE reverses and removes a non-transfer movement for the authenticated user.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import { findAccessibleProduct } from "@/lib/products/stock-product-access";
import { scheduleInvalidateStockAllocationCaches } from "@/lib/cache";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { z } from "zod";

const movementSchema = z.object({ productId: z.string().min(1), warehouseId: z.string().min(1), type: z.enum(["entry", "exit", "adjustment"]), quantity: z.number().int(), reason: z.string().trim().max(300).optional().nullable(), referenceId: z.string().trim().max(200).optional().nullable(), notes: z.string().trim().max(500).optional().nullable() }).superRefine((value, ctx) => { if (value.type === "entry" && value.quantity <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Entry quantity must be greater than zero" }); if (value.type === "exit" && value.quantity <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Exit quantity must be greater than zero" }); if (value.type === "adjustment" && value.quantity === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Adjustment cannot be zero" }); });

function serializeMovement(movement: { id: string; productId: string; warehouseId: string; userId: string; type: string; quantity: bigint; previousStock: bigint; newStock: bigint; reason: string | null; referenceId: string | null; notes: string | null; createdAt: Date }) { return { ...movement, quantity: movement.quantity.toString(), previousStock: movement.previousStock.toString(), newStock: movement.newStock.toString() }; }

export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard); if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request); if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url); const productId = searchParams.get("productId"); const warehouseId = searchParams.get("warehouseId"); const type = searchParams.get("type"); const rawLimit = Number(searchParams.get("limit") ?? 100); const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 250) : 100;
    const productIds = productId ? (await findAccessibleProduct({ id: session.id, role: session.role }, productId, "read")) ? [productId] : [] : undefined;
    if (productId && !productIds?.length) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    if (warehouseId) { const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, userId: session.id }, select: { id: true } }); if (!warehouse) return NextResponse.json({ error: "Warehouse not found" }, { status: 404 }); }
    const where = { userId: session.id, ...(productIds ? { productId: { in: productIds } } : {}), ...(warehouseId ? { warehouseId } : {}), ...(type && ["entry", "exit", "adjustment", "transfer_in", "transfer_out"].includes(type) ? { type } : {}) };
    const movements = await prisma.inventoryMovement.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
    return NextResponse.json(movements.map(serializeMovement));
  } catch (error) { logger.error("Error fetching inventory movements:", error); return NextResponse.json({ error: "Failed to fetch inventory movements" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard); if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request); if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); if ((session.role ?? "client") === "client") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    const validation = movementSchema.safeParse(body); if (!validation.success) return NextResponse.json({ error: "Invalid request body", details: validation.error.errors }, { status: 400 });
    const data = validation.data; const product = await findAccessibleProduct({ id: session.id, role: session.role }, data.productId, "write"); if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    const warehouse = await prisma.warehouse.findFirst({ where: { id: data.warehouseId, userId: session.id }, select: { id: true } }); if (!warehouse) return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    const movement = await prisma.$transaction(async (tx) => {
      const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: data.productId, warehouseId: data.warehouseId } } });
      const previousStock = allocation?.quantity ?? 0n; const reserved = allocation?.reservedQuantity ?? 0n; const delta = BigInt(data.quantity); const effectiveDelta = data.type === "entry" ? delta : data.type === "exit" ? -delta : delta; const newStock = previousStock + effectiveDelta;
      if (newStock < reserved) throw new Error(`Insufficient available stock. Available: ${previousStock - reserved}`);
      const updatedAllocation = allocation ? await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: newStock, updatedAt: new Date() } }) : await tx.stockAllocation.create({ data: { productId: data.productId, warehouseId: data.warehouseId, quantity: newStock, reservedQuantity: 0n, userId: session.id, createdAt: new Date() } });
      const allocations = await tx.stockAllocation.findMany({ where: { productId: data.productId }, select: { quantity: true } }); const totalStock = allocations.reduce((sum, row) => sum + row.quantity, 0n); await tx.product.update({ where: { id: data.productId }, data: { quantity: totalStock, updatedAt: new Date() } });
      return tx.inventoryMovement.create({ data: { productId: data.productId, warehouseId: data.warehouseId, userId: session.id, type: data.type, quantity: effectiveDelta, previousStock, newStock: updatedAllocation.quantity, reason: data.reason ?? null, referenceId: data.referenceId ?? null, notes: data.notes ?? null, createdAt: new Date() } });
    });
    await scheduleInvalidateStockAllocationCaches(); return NextResponse.json(serializeMovement(movement), { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "Failed to create inventory movement"; if (message.includes("Insufficient")) return NextResponse.json({ error: message }, { status: 409 }); logger.error("Error creating inventory movement:", error); return NextResponse.json({ error: "Failed to create inventory movement" }, { status: 500 }); }
}

export async function DELETE(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard); if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request); if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); if ((session.role ?? "client") === "client") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const id = new URL(request.url).searchParams.get("id"); if (!id) return NextResponse.json({ error: "Movement id is required" }, { status: 400 });
    const existing = await prisma.inventoryMovement.findFirst({ where: { id, userId: session.id } });
    if (!existing) return NextResponse.json({ error: "Movement not found" }, { status: 404 });
    if (existing.type === "transfer_in" || existing.type === "transfer_out") return NextResponse.json({ error: "Transfer movements must be reverted as a complete transfer" }, { status: 409 });
    await prisma.$transaction(async (tx) => {
      const allocation = await tx.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: existing.productId, warehouseId: existing.warehouseId } } });
      if (!allocation) throw new Error("Warehouse allocation not found");
      const reverseDelta = -existing.quantity; const newStock = allocation.quantity + reverseDelta;
      if (newStock < allocation.reservedQuantity) throw new Error(`Cannot revert movement because reserved stock is ${allocation.reservedQuantity}`);
      await tx.stockAllocation.update({ where: { id: allocation.id }, data: { quantity: newStock, updatedAt: new Date() } });
      const allocations = await tx.stockAllocation.findMany({ where: { productId: existing.productId }, select: { quantity: true } }); const totalStock = allocations.reduce((sum, row) => sum + row.quantity, 0n);
      await tx.product.update({ where: { id: existing.productId }, data: { quantity: totalStock, updatedAt: new Date() } });
      await tx.inventoryMovement.delete({ where: { id: existing.id } });
    });
    await scheduleInvalidateStockAllocationCaches(); return NextResponse.json({ success: true });
  } catch (error) { const message = error instanceof Error ? error.message : "Failed to delete inventory movement"; if (message.includes("reserved")) return NextResponse.json({ error: message }, { status: 409 }); logger.error("Error deleting inventory movement:", error); return NextResponse.json({ error: "Failed to delete inventory movement" }, { status: 500 }); }
}
