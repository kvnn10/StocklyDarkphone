import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { APPROVAL_TYPES, createApproval, decideApproval, listApprovals, type ApprovalStatus, type ApprovalType } from "@/lib/security/approvals";

export async function GET(request: NextRequest) {
  const authorization = await authorizeRequest(request, "approvals", "read");
  if (authorization.response) return authorization.response;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") as ApprovalStatus | null;
  if (status && !["pending", "approved", "rejected"].includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const requesterId = searchParams.get("requesterId") || undefined;
  return NextResponse.json({ approvals: await listApprovals(requesterId, status ?? undefined) });
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeRequest(request, "approvals", "create");
  if (authorization.response) return authorization.response;
  const session = authorization.session;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const type = body?.type as ApprovalType;
    if (!APPROVAL_TYPES.includes(type)) return NextResponse.json({ error: "Invalid approval type" }, { status: 400 });
    if (typeof body?.resource !== "string" || typeof body?.action !== "string") return NextResponse.json({ error: "resource and action are required" }, { status: 400 });
    const approval = await createApproval({ userId: session.id, type, resource: body.resource, action: body.action, entityId: typeof body.entityId === "string" ? body.entityId : null, reason: typeof body.reason === "string" ? body.reason : null, payload: body.payload && typeof body.payload === "object" ? body.payload : null });
    return NextResponse.json({ approval }, { status: 201 });
  } catch { return NextResponse.json({ error: "Failed to create approval request" }, { status: 500 }); }
}

export async function PATCH(request: NextRequest) {
  const authorization = await authorizeRequest(request, "approvals", "approve");
  if (authorization.response) return authorization.response;
  const session = authorization.session;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (typeof body?.approvalId !== "string" || !["approve", "reject"].includes(body?.decision)) return NextResponse.json({ error: "approvalId and decision are required" }, { status: 400 });
    const approval = await decideApproval({ approvalId: body.approvalId, approverId: session.id, decision: body.decision, note: typeof body.note === "string" ? body.note : null });
    return NextResponse.json({ approval });
  } catch (error) {
    const code = error instanceof Error ? error.message : "APPROVAL_ERROR";
    const status = code === "APPROVAL_NOT_FOUND" ? 404 : code === "APPROVAL_ALREADY_DECIDED" || code === "SELF_APPROVAL_FORBIDDEN" ? 409 : 400;
    return NextResponse.json({ error: code }, { status });
  }
}
