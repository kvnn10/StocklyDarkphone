/**
 * Users API Route Handler
 * GET /api/users — list users (users.read)
 * POST /api/users — create user (users.create)
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { logger } from "@/lib/logger";
import { getAllUsers, createUserAdmin, emailExists, usernameExists } from "@/prisma/user-admin";
import { createAuditLog } from "@/prisma/audit-log";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { createUserAdminSchema } from "@/lib/validations/user-management";
import { cacheKeys, getCache, scheduleInvalidateUserCaches, setCache } from "@/lib/cache";
import type { UserForAdmin } from "@/types";

function transform(r: Awaited<ReturnType<typeof getAllUsers>>[number]): UserForAdmin {
  return { id: r.id, email: r.email, name: r.name, username: r.username, role: r.role as UserForAdmin["role"], image: r.image, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt?.toISOString() ?? null };
}

export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await authorizeRequest(request, "users", "read");
    if (auth.response) return auth.response;
    const cacheKey = cacheKeys.userManagement.list({});
    const cacheReadStartedAt = Date.now();
    const cached = await getCache<UserForAdmin[]>(cacheKey);
    if (cached) return NextResponse.json(cached);
    const result = (await getAllUsers()).map(transform);
    await setCache(cacheKey, result, 300, { fetchedAt: cacheReadStartedAt });
    return NextResponse.json(result);
  } catch (error) {
    logger.error("Error fetching users:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await authorizeRequest(request, "users", "create");
    if (auth.response) return auth.response;
    const session = auth.session!;
    const body = await request.json();
    const validation = createUserAdminSchema.safeParse(body);
    if (!validation.success) {
      logger.warn("Invalid user creation data", { errors: validation.error.errors });
      return NextResponse.json({ error: "Invalid request body", details: validation.error.errors }, { status: 400 });
    }
    const data = validation.data;
    if (await emailExists(data.email)) return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    if (data.username && (await usernameExists(data.username))) return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    const created = await createUserAdmin(data);
    createAuditLog({ userId: session.id, action: "create", entityType: "user", entityId: created.id }).catch(() => {});
    await scheduleInvalidateUserCaches();
    return NextResponse.json(transform(created), { status: 201 });
  } catch (error) {
    logger.error("Error creating user:", error);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
