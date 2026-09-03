import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { hasPermission, type Resource } from "@/lib/security/rbac";
export async function authorizeRequest(request: NextRequest, resource: Resource, action: string) {
  const session = await getSessionFromRequest(request);
  if (!session) return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!hasPermission(session.role, resource, action)) return { session, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { session, response: null };
}
