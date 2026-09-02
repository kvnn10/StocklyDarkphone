import { NextRequest, NextResponse } from "next/server";
import { reconcileStripeLedger } from "@/lib/payments/reconcile-stripe-ledger";
import { prisma } from "@/prisma/client";
import { getServerSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  try {
    const report = await reconcileStripeLedger({
      orderId: params.get("orderId") || undefined,
      paymentIntentId: params.get("paymentIntentId") || undefined,
    });
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: "Reconciliation failed" },
      { status: 500 },
    );
  }
}
