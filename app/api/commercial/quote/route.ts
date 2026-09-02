import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { quotePricing } from "@/lib/commercial/pricing";

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Debe enviar al menos un producto" }, { status: 400 });
    }
    const items = body.items.map((item: Record<string, unknown>) => ({
      productId: String(item.productId ?? ""),
      quantity: Number(item.quantity),
      discountType: item.discountType === "fixed" ? "fixed" : item.discountType === "percent" ? "percent" : undefined,
      discountValue: item.discountValue === undefined ? undefined : Number(item.discountValue),
    }));
    const result = await quotePricing(session.id, items, session.role === "admin");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo calcular la cotización" }, { status: 400 });
  }
}
