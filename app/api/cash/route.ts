import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { writeAuditLog } from "@/lib/audit/log";

const TYPES = ["income", "expense"] as const;
const METHODS = ["cash", "card", "transfer", "other"] as const;
const ROLES = ["admin", "user", "retailer"] as const;

const validId = (value: unknown) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

function serializeMovement(movement: {
  id: string;
  type: string;
  source: string;
  amount: number;
  paymentMethod: string;
  orderId: string | null;
  orderNumber: string | null;
  userId: string;
  createdBy: string;
  description: string | null;
  status: string;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
  createdAt: Date;
}) {
  return {
    ...movement,
    _id: movement.id,
    voidedAt: movement.voidedAt?.toISOString() ?? null,
    createdAt: movement.createdAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const movements = await prisma.cashMovement.findMany({
      where: { userId: session.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const saleOrderIds = movements
      .filter((m) => m.source === "sale" && m.orderId)
      .map((m) => m.orderId as string);

    const cancelledOrderIds = new Set<string>();
    if (saleOrderIds.length > 0) {
      const orders = await prisma.order.findMany({
        where: {
          id: { in: saleOrderIds },
          userId: session.id,
          OR: [{ status: "cancelled" }, { paymentStatus: "refunded" }],
        },
        select: { id: true },
      });
      for (const order of orders) cancelledOrderIds.add(order.id);
    }

    const normalizedMovements = movements.map((movement) => {
      const isCancelledSale = movement.source === "sale" && movement.orderId && cancelledOrderIds.has(movement.orderId);
      if (!isCancelledSale || movement.status === "voided") return serializeMovement(movement);
      return serializeMovement({
        ...movement,
        status: "voided",
        voidedAt: movement.voidedAt ?? new Date(),
        voidReason: movement.voidReason ?? "Venta cancelada o reembolsada",
      });
    });

    const activeMovements = normalizedMovements.filter((m) => m.status !== "voided");
    const income = activeMovements.filter((m) => m.type === "income").reduce((sum, m) => sum + Number(m.amount || 0), 0);
    const expense = activeMovements.filter((m) => m.type === "expense").reduce((sum, m) => sum + Number(m.amount || 0), 0);
    const refunds = activeMovements.filter((m) => m.source === "refund").reduce((sum, m) => sum + Number(m.amount || 0), 0);

    return NextResponse.json({
      movements: normalizedMovements,
      summary: { income, expense, refunds, balance: income - expense },
    });
  } catch (error) {
    console.error("GET /api/cash", error);
    return NextResponse.json({ error: "No se pudieron obtener los movimientos" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (!TYPES.includes(body.type) || !METHODS.includes(body.paymentMethod)) {
      return NextResponse.json({ error: "Tipo o método de pago inválido" }, { status: 400 });
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "El valor debe ser mayor que cero" }, { status: 400 });
    }

    const orderId = typeof body.orderId === "string" && body.orderId.trim() ? body.orderId.trim() : null;
    if (orderId && !validId(orderId)) {
      return NextResponse.json({ error: "ID de venta inválido" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (orderId) {
        const order = await tx.order.findFirst({ where: { id: orderId, userId: session.id } });
        if (!order) throw Object.assign(new Error("Venta no encontrada o no autorizada"), { status: 404 });
        if (order.status === "cancelled" || order.paymentStatus === "refunded") {
          throw Object.assign(new Error("No se puede registrar Caja para una venta cancelada o reembolsada"), { status: 409 });
        }

        const existing = await tx.cashMovement.findFirst({
          where: { userId: session.id, orderId, source: "sale", status: { not: "voided" } },
        });
        if (existing) return { movement: existing, created: false };
      }

      const description = typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : orderId ? "Venta" : "Movimiento manual";

      const movement = await tx.cashMovement.create({
        data: {
          type: body.type,
          source: orderId ? "sale" : "manual",
          orderId,
          amount,
          paymentMethod: body.paymentMethod,
          userId: session.id,
          createdBy: session.id,
          description,
          status: "active",
          createdAt: new Date(),
        },
      });
      return { movement, created: true };
    });

    if (result.created) {
      await writeAuditLog({
        userId: session.id,
        action: "CASH_MOVEMENT_CREATED",
        entityType: "CashMovement",
        entityId: result.movement.id,
        details: {
          type: result.movement.type,
          source: result.movement.source,
          amount: result.movement.amount,
          paymentMethod: result.movement.paymentMethod,
          orderId: result.movement.orderId ?? null,
          description: result.movement.description,
        },
        userAgent: request.headers.get("user-agent"),
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip"),
      });
    }

    return NextResponse.json(serializeMovement(result.movement), { status: result.created ? 201 : 200 });
  } catch (error) {
    console.error("POST /api/cash", error);
    const status = typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? Number((error as { status: number }).status)
      : 500;
    const message = error instanceof Error ? error.message : "No se pudo registrar el movimiento";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!validId(id)) return NextResponse.json({ error: "Movimiento inválido" }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const movement = await tx.cashMovement.findFirst({ where: { id, userId: session.id } });
      if (!movement) throw Object.assign(new Error("Movimiento no encontrado"), { status: 404 });
      if (movement.status === "voided") throw Object.assign(new Error("El movimiento ya está anulado"), { status: 409 });

      const voidReason = typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : "Movimiento anulado manualmente";

      return tx.cashMovement.update({
        where: { id: movement.id },
        data: {
          status: "voided",
          voidedAt: new Date(),
          voidedBy: session.id,
          voidReason,
        },
      });
    });

    await writeAuditLog({
      userId: session.id,
      action: "CASH_MOVEMENT_VOIDED",
      entityType: "CashMovement",
      entityId: id,
      details: {
        type: result.type,
        source: result.source,
        amount: result.amount,
        paymentMethod: result.paymentMethod,
        orderId: result.orderId ?? null,
        reason: result.voidReason,
      },
      userAgent: request.headers.get("user-agent"),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip"),
    });

    return NextResponse.json({ ok: true, message: "Movimiento anulado correctamente" });
  } catch (error) {
    console.error("DELETE /api/cash", error);
    const status = typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? Number((error as { status: number }).status)
      : 500;
    const message = error instanceof Error ? error.message : "No se pudo anular el movimiento";
    return NextResponse.json({ error: message }, { status });
  }
}
