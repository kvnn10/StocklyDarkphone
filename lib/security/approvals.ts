import { prisma } from "@/prisma/client";
import { ObjectId } from "mongodb";

export const APPROVAL_TYPES = ["discount", "refund", "cancellation", "inventory_adjustment", "cash_close"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];
export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ApprovalRequest = {
  id: string;
  requesterId: string;
  type: ApprovalType;
  resource: string;
  action: string;
  entityId: string | null;
  status: ApprovalStatus;
  reason: string | null;
  payload: Record<string, unknown> | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

type AuditDetails = { approvalId: string; type: ApprovalType; resource: string; action: string; entityId: string | null; status: ApprovalStatus; reason?: string; payload?: Record<string, unknown>; decisionNote?: string };

function readDetails(details: unknown): AuditDetails | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  if (typeof d.approvalId !== "string" || typeof d.type !== "string" || typeof d.resource !== "string" || typeof d.action !== "string" || typeof d.status !== "string") return null;
  if (!["pending", "approved", "rejected"].includes(d.status)) return null;
  return d as unknown as AuditDetails;
}

async function writeApprovalEvent(userId: string, action: string, details: AuditDetails) {
  const jsonDetails = JSON.parse(JSON.stringify(details));
  await prisma.auditLog.create({ data: { userId, action, entityType: "approval", entityId: details.approvalId, details: jsonDetails } });
}

export async function createApproval(input: { userId: string; type: ApprovalType; resource: string; action: string; entityId?: string | null; reason?: string | null; payload?: Record<string, unknown> | null }) {
  const id = new ObjectId().toHexString();
  const details: AuditDetails = { approvalId: id, type: input.type, resource: input.resource, action: input.action, entityId: input.entityId ?? null, status: "pending", reason: input.reason ?? undefined, payload: input.payload ?? undefined };
  await writeApprovalEvent(input.userId, "approval_requested", details);
  return toApproval(input.userId, details, null, null);
}

export async function listApprovals(userId?: string, status?: ApprovalStatus) {
  const logs = await prisma.auditLog.findMany({ where: { entityType: "approval", action: { in: ["approval_requested", "approval_approved", "approval_rejected"] }, ...(userId ? { userId } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
  const latest = new Map<string, { requesterId: string; details: AuditDetails; decidedBy: string | null; decidedAt: Date | null; decisionNote: string | null; createdAt: Date }>();
  for (const log of logs) {
    const details = readDetails(log.details);
    if (!details || latest.has(details.approvalId)) continue;
    latest.set(details.approvalId, { requesterId: log.userId, details, decidedBy: log.action === "approval_requested" ? null : log.userId, decidedAt: log.action === "approval_requested" ? null : log.createdAt, decisionNote: details.decisionNote ?? null, createdAt: log.createdAt });
  }
  return [...latest.values()].filter((item) => !status || item.details.status === status).map((item) => toApproval(item.requesterId, item.details, item.decidedBy, item.decidedAt, item.decisionNote, item.createdAt));
}

export async function getApprovedApproval(input: { approvalId: string; requesterId: string; type: ApprovalType; resource: string; action: string; entityId?: string | null }) {
  const events = await prisma.auditLog.findMany({ where: { entityType: "approval", entityId: input.approvalId, action: { in: ["approval_requested", "approval_approved", "approval_rejected"] } }, orderBy: { createdAt: "desc" }, take: 20 });
  const requestEvent = [...events].reverse().find((event) => event.action === "approval_requested");
  if (!requestEvent || requestEvent.userId !== input.requesterId) return null;
  const decisionEvent = events.find((event) => event.action === "approval_approved" || event.action === "approval_rejected");
  if (!decisionEvent || decisionEvent.action !== "approval_approved") return null;
  const details = readDetails(decisionEvent.details);
  if (!details || details.type !== input.type || details.resource !== input.resource || details.action !== input.action) return null;
  if (input.entityId !== undefined && details.entityId !== (input.entityId ?? null)) return null;
  return { ...toApproval(requestEvent.userId, details, decisionEvent.userId, decisionEvent.createdAt, details.decisionNote ?? null, requestEvent.createdAt), approvedBy: decisionEvent.userId };
}

export async function decideApproval(input: { approvalId: string; approverId: string; decision: "approve" | "reject"; note?: string | null }) {
  const events = await prisma.auditLog.findMany({ where: { entityType: "approval", action: { in: ["approval_requested", "approval_approved", "approval_rejected"] }, entityId: input.approvalId }, orderBy: { createdAt: "desc" }, take: 20 });
  const requestEvent = [...events].reverse().find((event) => event.action === "approval_requested");
  if (!requestEvent) throw new Error("APPROVAL_NOT_FOUND");
  const current = events.find((event) => event.action === "approval_approved" || event.action === "approval_rejected");
  if (current) throw new Error("APPROVAL_ALREADY_DECIDED");
  if (requestEvent.userId === input.approverId) throw new Error("SELF_APPROVAL_FORBIDDEN");
  const details = readDetails(requestEvent.details);
  if (!details) throw new Error("APPROVAL_INVALID");
  const status: ApprovalStatus = input.decision === "approve" ? "approved" : "rejected";
  const next: AuditDetails = { ...details, status, decisionNote: input.note ?? undefined };
  await writeApprovalEvent(input.approverId, input.decision === "approve" ? "approval_approved" : "approval_rejected", next);
  return toApproval(requestEvent.userId, next, input.approverId, new Date(), input.note ?? null, requestEvent.createdAt);
}

function toApproval(requesterId: string, details: AuditDetails, decidedBy: string | null, decidedAt: Date | null, decisionNote: string | null = null, createdAt: Date = new Date()): ApprovalRequest {
  return { id: details.approvalId, requesterId, type: details.type, resource: details.resource, action: details.action, entityId: details.entityId, status: details.status, reason: details.reason ?? null, payload: details.payload ?? null, decidedBy, decidedAt: decidedAt?.toISOString() ?? null, decisionNote, createdAt: createdAt.toISOString() };
}
