import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { jsonSafe, validObjectId } from "@/lib/finance/financial-ledger";
import { getSupplierStatement } from "@/lib/finance/supplier-payables";

const ROLES = ["admin", "user", "retailer"];

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const supplierId = request.nextUrl.searchParams.get("supplierId");
  if (!validObjectId(supplierId)) return NextResponse.json({ error: "Proveedor inválido" }, { status: 400 });
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, userId: session.id } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  const statement = await getSupplierStatement(session.id, supplierId!);
  return NextResponse.json(jsonSafe({ supplier: { id: supplier.id, name: supplier.name, status: supplier.status }, ...statement }));
}
