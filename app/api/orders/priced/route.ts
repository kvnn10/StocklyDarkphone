import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { createOrder } from "@/prisma/order";
import { quotePricing } from "@/lib/commercial/pricing";
import { createAuditLog } from "@/prisma/audit-log";
import { invalidateOnOrderChange } from "@/lib/cache";

type PricedOrderItem = {
  productId: string;
  quantity: number;
  warehouseId?: string;
  discountType?: "fixed" | "percent";
  discountValue?: number;
};

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (!Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: "Debe enviar al menos un producto" }, { status: 400 });
    const items: PricedOrderItem[] = body.items.map((item: Record<string, unknown>) => ({
      productId: String(item.productId ?? ""),
      quantity: Number(item.quantity),
      warehouseId: item.warehouseId ? String(item.warehouseId) : undefined,
      discountType: item.discountType === "fixed" ? "fixed" : item.discountType === "percent" ? "percent" : undefined,
      discountValue: item.discountValue === undefined ? undefined : Number(item.discountValue),
    }));
    const quote = await quotePricing(session.id, items, session.role === "admin");
    const tax = Number(body.tax ?? 0);
    const shipping = Number(body.shipping ?? 0);
    if (!Number.isFinite(tax) || tax < 0 || !Number.isFinite(shipping) || shipping < 0) return NextResponse.json({ error: "Impuestos o envío inválidos" }, { status: 400 });
    const order = await createOrder({
      clientId: typeof body.clientId === "string" ? body.clientId : undefined,
      items: items.map(({ productId, quantity, warehouseId }) => ({ productId, quantity, warehouseId })),
      tax,
      shipping,
      discount: quote.discount,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    }, { storeOwnerUserId: session.id, createdByUserId: session.id, clientId: typeof body.clientId === "string" ? body.clientId : null });
    await createAuditLog({ userId: session.id, action: "COMMERCIAL_PRICING_APPLIED", entityType: "order", entityId: order.id, details: { orderNumber: order.orderNumber, gross: quote.gross, discount: quote.discount, subtotal: quote.subtotal, cost: quote.cost, margin: quote.margin, lines: quote.lines.map((line) => ({ productId: line.productId, quantity: line.quantity, promotion: line.promotion?.id ?? null, promotionDiscount: line.promotionDiscount, manualDiscount: line.manualDiscount, discount: line.discount, subtotal: line.subtotal })) } });
    await invalidateOnOrderChange();
    return NextResponse.json({ ok: true, order, pricing: quote }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear la venta" }, { status: 400 });
  }
}
