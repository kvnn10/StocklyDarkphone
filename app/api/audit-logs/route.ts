/**
 * Audit Logs API Route
 * GET /api/audit-logs — get audit logs with RBAC protection
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getAuditLogs, getAuditLogsForActivity, type ActivityLogPeriod } from "@/prisma/audit-log";
import { prisma } from "@/prisma/client";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { authorizeRequest } from "@/lib/security/authorize";
import type { AuditLog, AuditAction, AuditEntityType } from "@/types";

type LogRecord = Awaited<ReturnType<typeof getAuditLogs>>["logs"][number] | Awaited<ReturnType<typeof getAuditLogsForActivity>>[number];
function transform(log: LogRecord, userMap: Map<string, { name?: string | null; username?: string | null; email: string }>): AuditLog {
  const user = userMap.get(log.userId);
  return { id: log.id, userId: log.userId, action: log.action as AuditAction, entityType: log.entityType as AuditEntityType, entityId: log.entityId, details: log.details as Record<string, unknown> | null, ipAddress: log.ipAddress, userAgent: log.userAgent, createdAt: log.createdAt.toISOString(), user: user ? { id: log.userId, name: user.name ?? null, username: user.username ?? user.name ?? undefined, email: user.email } : undefined };
}
export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const authorization = await authorizeRequest(request, "audit", "read");
    if (authorization.response) return authorization.response;
    const session = authorization.session;
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") as ActivityLogPeriod | null;
    if (period && ["today", "7days", "month"].includes(period)) {
      const resultLogs = await getAuditLogsForActivity(period, session.id);
      const userIds = [...new Set(resultLogs.map((log) => log.userId))];
      const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
      const userMap = new Map(users.map((u) => [u.id, u]));
      return NextResponse.json({ logs: resultLogs.map((log) => transform(log, userMap)), pagination: null });
    }
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const userId = searchParams.get("userId") || undefined;
    const action = searchParams.get("action") as AuditAction | undefined;
    const entityType = searchParams.get("entityType") as AuditEntityType | undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const result = await getAuditLogs({ page, limit, userId, action, entityType, startDate, endDate });
    const userIds = [...new Set(result.logs.map((log) => log.userId))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
    const userMap = new Map(users.map((u) => [u.id, u]));
    return NextResponse.json({ logs: result.logs.map((log) => transform(log, userMap)), pagination: result.pagination });
  } catch (error) {
    logger.error("Error fetching audit logs:", error);
    return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: 500 });
  }
}
