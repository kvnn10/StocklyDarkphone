import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/security/authorize";
import { runAutomationRules } from "@/lib/automation/rules";

function isCronRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

async function run(request: NextRequest) {
  if (!isCronRequest(request)) {
    const auth = await authorizeRequest(request, "notifications", "create");
    if (auth.response) return auth.response;
    if (!auth.session || !["admin", "gerente"].includes(auth.session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, summary: await runAutomationRules() });
  } catch (error) {
    console.error("automation run failed", error);
    return NextResponse.json({ error: "Automation run failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) { return run(request); }
export async function GET(request: NextRequest) { return run(request); }
