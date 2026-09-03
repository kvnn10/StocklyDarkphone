/**
 * Suppliers API Route Handler
 * Supplier CRUD with centralized server-side RBAC.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/prisma/client";
import { createAuditLog } from "@/prisma/audit-log";
import { getSuppliersForAdminIncludingDemo, getDemoSupplierUserId } from "@/prisma/supplier";
import { createSupplierBodySchema, updateSupplierBodySchema } from "@/lib/validations/supplier";
import { scheduleInvalidateSupplierCaches } from "@/lib/cache";
import { authorizeRequest } from "@/lib/security/authorize";

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, "suppliers", "read");
    if (auth.response) return auth.response;
    const session = auth.session!;
    const userId = session.id;
    const isClient = session.role === "client";
    const { enrichSuppliersWithListFields, countActiveCatalogProductsForUser } = await import("@/lib/server/catalog-list-enrich");
    const suppliers = isClient ? await prisma.supplier.findMany({ where: { userId } }) : await getSuppliersForAdminIncludingDemo(userId);
    const [demoUserId, catalogProductTotal] = await Promise.all([getDemoSupplierUserId(), countActiveCatalogProductsForUser(userId)]);
    const withFlags = suppliers.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt?.toISOString() ?? null, isGlobalDemo: demoUserId != null && s.userId === demoUserId }));
    const enriched = await enrichSuppliersWithListFields(withFlags, userId);
    return NextResponse.json(enriched.map((s) => ({ ...s, catalogProductTotal })));
  } catch (error) { logger.error("Error fetching suppliers:", error); return NextResponse.json({ error: "Failed to fetch suppliers" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, "suppliers", "create");
    if (auth.response) return auth.response;
    const session = auth.session!;
    const userId = session.id;
    const body = await request.json();
    const validationResult = createSupplierBodySchema.safeParse(body);
    if (!validationResult.success) return NextResponse.json({ error: "Invalid request body", details: validationResult.error.errors }, { status: 400 });
    const { name, status, description, notes } = validationResult.data;
    const supplier = await prisma.supplier.create({ data: { name, userId, status: status ?? true, description: description && typeof description === "string" ? description.trim() || null : null, notes: notes && typeof notes === "string" ? notes.trim() || null : null, createdBy: userId, createdAt: new Date(), updatedAt: null } });
    createAuditLog({ userId, action: "create", entityType: "supplier", entityId: supplier.id, details: { name: supplier.name } }).catch(() => {});
    await scheduleInvalidateSupplierCaches();
    return NextResponse.json(supplier, { status: 201 });
  } catch (error) { logger.error("Error creating supplier:", error); return NextResponse.json({ error: "Failed to create supplier" }, { status: 500 }); }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, "suppliers", "update");
    if (auth.response) return auth.response;
    const session = auth.session!;
    const userId = session.id;
    const body = await request.json();
    const validationResult = updateSupplierBodySchema.safeParse(body);
    if (!validationResult.success) return NextResponse.json({ error: "Invalid request body", details: validationResult.error.errors }, { status: 400 });
    const { id, name, status, description, notes } = validationResult.data;
    const existingSupplier = await prisma.supplier.findFirst({ where: { id, userId } });
    if (!existingSupplier) return NextResponse.json({ error: "Supplier not found or unauthorized" }, { status: 404 });
    const updateData: { name: string; updatedBy: string; updatedAt: Date; status?: boolean; description?: string | null; notes?: string | null } = { name, updatedBy: userId, updatedAt: new Date() };
    if (status !== undefined) updateData.status = Boolean(status);
    if (description !== undefined) updateData.description = description && typeof description === "string" ? description.trim() || null : null;
    if (notes !== undefined) updateData.notes = notes && typeof notes === "string" ? notes.trim() || null : null;
    const supplier = await prisma.supplier.update({ where: { id }, data: updateData });
    createAuditLog({ userId, action: "update", entityType: "supplier", entityId: id, details: { name: supplier.name } }).catch(() => {});
    await scheduleInvalidateSupplierCaches();
    return NextResponse.json(supplier);
  } catch (error) { logger.error("Error updating supplier:", error); return NextResponse.json({ error: "Failed to update supplier" }, { status: 500 }); }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, "suppliers", "delete");
    if (auth.response) return auth.response;
    const session = auth.session!;
    const userId = session.id;
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Supplier ID is required" }, { status: 400 });
    const existingSupplier = await prisma.supplier.findFirst({ where: { id, userId } });
    if (!existingSupplier) return NextResponse.json({ error: "Supplier not found or unauthorized" }, { status: 404 });
    await prisma.supplier.delete({ where: { id } });
    createAuditLog({ userId, action: "delete", entityType: "supplier", entityId: id, details: { name: existingSupplier.name } }).catch(() => {});
    await scheduleInvalidateSupplierCaches();
    return NextResponse.json({ success: true });
  } catch (error) { logger.error("Error deleting supplier:", error); return NextResponse.json({ error: "Failed to delete supplier" }, { status: 500 }); }
}
