import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { prisma } from "@/prisma/client";
import { jsonSafe, validObjectId } from "@/lib/finance/financial-ledger";
import { getSupplierStatement } from "@/lib/finance/supplier-payables";

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, "finance", "read");
  if (auth.response) return auth.response;
  const session = auth.session!;
  const supplierId = request.nextUrl.searchParams.get("supplierId");
  if (!validObjectId(supplierId)) return NextResponse.json({ error: "Proveedor inválido" }, { status: 400 });
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, userId: session.id } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  const statement = await getSupplierStatement(session.id, supplierId!);
  return NextResponse.json(jsonSafe({ supplier: { id: supplier.id, name: supplier.name, status: supplier.status }, ...statement }));
}
