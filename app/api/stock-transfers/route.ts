/**
 * Stock Transfers API — POST create + complete transfer atomically (REQ-0066).
 * Completed transfers are also recorded in the inventory movement ledger.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/prisma/client";
import { findAccessibleProduct } from "@/lib/products/stock-product-access";
import { createStockTransfer, completeStockTransfer, cancelStockTransfer } from "@/prisma/stock-allocation";
import { createStockTransferSchema } from "@/lib/validations/stock-allocation";
import { scheduleInvalidateStockAllocationCaches } from "@/lib/cache";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { isExpectedClientError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    const validationResult = createStockTransferSchema.safeParse(body);
    if (!validationResult.success) return NextResponse.json({ error: "Invalid request body", details: validationResult.error.errors }, { status: 400 });
    const data = validationResult.data;
    if (data.fromWarehouseId === data.toWarehouseId) return NextResponse.json({ error: "Source and destination warehouses must differ" }, { status: 400 });
    if ((session.role ?? "client") === "client") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const product = await findAccessibleProduct({ id: session.id, role: session.role }, data.productId, "write");
    const [fromWarehouse, toWarehouse] = await Promise.all([
      prisma.warehouse.findFirst({ where: { id: data.fromWarehouseId, userId: session.id }, select: { id: true } }),
      prisma.warehouse.findFirst({ where: { id: data.toWarehouseId, userId: session.id }, select: { id: true } }),
    ]);
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    if (!fromWarehouse || !toWarehouse) return NextResponse.json({ error: "Warehouse not found or unauthorized" }, { status: 404 });

    const [sourceBefore, destinationBefore] = await Promise.all([
      prisma.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: data.productId, warehouseId: data.fromWarehouseId } }, select: { quantity: true } }),
      prisma.stockAllocation.findUnique({ where: { productId_warehouseId: { productId: data.productId, warehouseId: data.toWarehouseId } }, select: { quantity: true } }),
    ]);

    const transfer = await createStockTransfer(data, session.id);
    try { await completeStockTransfer(transfer.id, session.id); }
    catch (completeError) {
      await cancelStockTransfer(transfer.id, session.id).catch((cancelErr) => logger.warn("Failed to cancel pending stock transfer after complete error", { transferId: transfer.id, cancelErr }));
      throw completeError;
    }

    const quantity = BigInt(Number(transfer.quantity));
    const sourcePrevious = sourceBefore?.quantity ?? 0n;
    const destinationPrevious = destinationBefore?.quantity ?? 0n;
    await prisma.inventoryMovement.createMany({ data: [
      { productId: data.productId, warehouseId: data.fromWarehouseId, userId: session.id, type: "transfer_out", quantity: -quantity, previousStock: sourcePrevious, newStock: sourcePrevious - quantity, reason: "Transferencia entre bodegas", referenceId: transfer.id, notes: data.notes ?? null, createdAt: new Date() },
      { productId: data.productId, warehouseId: data.toWarehouseId, userId: session.id, type: "transfer_in", quantity, previousStock: destinationPrevious, newStock: destinationPrevious + quantity, reason: "Transferencia entre bodegas", referenceId: transfer.id, notes: data.notes ?? null, createdAt: new Date() },
    ] });

    await scheduleInvalidateStockAllocationCaches();
    return NextResponse.json({ id: transfer.id, status: "completed", productId: transfer.productId, fromWarehouseId: transfer.fromWarehouseId, toWarehouseId: transfer.toWarehouseId, quantity: Number(transfer.quantity) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create stock transfer";
    if (isExpectedClientError(error) || message.includes("Insufficient")) return NextResponse.json({ error: message }, { status: 400 });
    logger.error("Error creating stock transfer:", error);
    return NextResponse.json({ error: "Failed to create stock transfer" }, { status: 500 });
  }
}
