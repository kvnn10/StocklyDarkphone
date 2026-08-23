import { prisma } from "@/prisma/client";

export type AuditLogInput = {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** Best-effort audit writer: business operations must not fail because logging failed. */
export async function writeAuditLog(input: AuditLogInput) {
  try {
    return await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? undefined,
        details: input.details === undefined ? undefined : JSON.parse(JSON.stringify(input.details)),
        ipAddress: input.ipAddress ?? undefined,
        userAgent: input.userAgent ?? undefined,
      },
    });
  } catch (error) {
    console.error("Audit log write failed", error);
    return null;
  }
}
