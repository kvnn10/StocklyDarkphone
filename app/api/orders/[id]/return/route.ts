/**
 * POST /api/orders/:id/return
 * Full-order return/refund endpoint.
 * Uses the existing cancellation/refund lifecycle so stock, allocations,
 * Stripe refund, invoice and cash ledger stay synchronized and idempotent.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getOrderByIdForAdmin, getOrderById, getOrderByIdForProductOwner, cancelOrder } from "@/prisma/order";
import { createAuditLog } from "@/prisma/audit-log";
import { invalidateOnOrderChange } from "@/lib/cache";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Only administrators can process order returns" }, { status: 403 });
    }

    const { id } = await params;
    const order = await getOrderByIdForAdmin(id);
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    if (order.status === "cancelled") {
      return NextResponse.json({ success: true, alreadyReturned: true, message: "La devolución ya fue procesada." });
    }
    if (!["confirmed", "processing", "shipped", "delivered"].includes(order.status) && order.paymentStatus !== "paid") {
      return NextResponse.json({ error: "Solo se puede devolver una venta confirmada o pagada." }, { status: 409 });
    }

    const cancelled = await cancelOrder(id, order.userId);

    await createAuditLog({
      userId: session.id,
      action: "update",
      entityType: "order",
      entityId: id,
      details: {
        orderNumber: order.orderNumber,
        action: "return",
        amount: Number(order.total),
        paymentStatusBefore: order.paymentStatus,
        paymentStatusAfter: cancelled.paymentStatus,
      },
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    });

    await invalidateOnOrderChange();
    return NextResponse.json({
      success: true,
      returned: true,
      order: cancelled,
      message: "Devolución procesada correctamente.",
    });
  } catch (error) {
    logger.error("Error processing order return:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo procesar la devolución" },
      { status: 500 },
    );
  }
}
