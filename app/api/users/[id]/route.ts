/** User Detail API Route Handler */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { logger } from "@/lib/logger";
import { getUserById, updateUserAdmin, deleteUserAdmin } from "@/prisma/user-admin";
import { updateUserAdminSchema } from "@/lib/validations";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { createAuditLog } from "@/prisma/audit-log";
import type { UpdateUserAdminInput } from "@/types";
import { getUserDetailForPage, transformUserForAdmin } from "@/lib/server/user-detail-data";
import { scheduleInvalidateUserCaches } from "@/lib/cache";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await authorizeRequest(request, "users", "read");
    if (auth.response) return auth.response;
    const { id } = await params;
    const detail = await getUserDetailForPage({ id: auth.session!.id, role: auth.session!.role }, id);
    if (!detail) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    logger.error("Error fetching user:", error);
    return NextResponse.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await authorizeRequest(request, "users", "update");
    if (auth.response) return auth.response;
    const session = auth.session!;
    const { id } = await params;
    const existing = await getUserById(id);
    if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const parsed = updateUserAdminSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid request body", details: parsed.error.errors }, { status: 400 });
    const data = parsed.data;
    const updatePayload: UpdateUserAdminInput = {};
    if (data.role !== undefined) updatePayload.role = data.role;
    if (data.name !== undefined) updatePayload.name = data.name;
    const updated = await updateUserAdmin(id, updatePayload);
    createAuditLog({ userId: session.id, action: "update", entityType: "user", entityId: id }).catch(() => {});
    await scheduleInvalidateUserCaches();
    return NextResponse.json(transformUserForAdmin(updated));
  } catch (error) {
    logger.error("Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await authorizeRequest(request, "users", "delete");
    if (auth.response) return auth.response;
    const session = auth.session!;
    const { id } = await params;
    if (id === session.id) return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    const existing = await getUserById(id);
    if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const deleted = await deleteUserAdmin(id);
    createAuditLog({ userId: session.id, action: "delete", entityType: "user", entityId: id }).catch(() => {});
    await scheduleInvalidateUserCaches();
    return NextResponse.json(transformUserForAdmin(deleted));
  } catch (error) {
    logger.error("Error deleting user:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
