import { NextRequest, NextResponse } from "next/server";

const OWNER_LOGIN = "kvnn10";
const TITLE_PREFIX = "[STOCKLY CREATE]";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function response(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  const issueNumber = Number(new URL(request.url).searchParams.get("issue"));
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return response(400, { error: "A valid GitHub issue number is required" });
  }

  const issueUrl = `https://api.github.com/repos/kvnn10/StocklyDarkphone/issues/${issueNumber}`;
  const githubResponse = await fetch(issueUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "StocklyDarkphone",
    },
    cache: "no-store",
  });

  if (!githubResponse.ok) {
    return response(502, { error: "Unable to read the GitHub issue" });
  }

  const issue = (await githubResponse.json()) as {
    number: number;
    state: string;
    title: string;
    body: string | null;
    user?: { login?: string } | null;
  };

  // Only issues opened by the repository owner can enqueue product creation.
  // The issue must also be open and explicitly marked as a Stockly command.
  if (issue.user?.login !== OWNER_LOGIN) return response(403, { error: "Issue author is not authorized" });
  if (issue.state !== "open") return response(409, { error: "Issue is already closed or processed" });
  if (!issue.title.startsWith(TITLE_PREFIX)) return response(400, { error: "Issue is not a Stockly product command" });

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(issue.body || "") as Record<string, unknown>;
  } catch {
    return response(400, { error: "Issue body must contain valid JSON" });
  }

  const required = ["name", "sku", "price", "quantity", "category", "supplier"];
  for (const field of required) {
    if (args[field] === undefined || args[field] === null || (typeof args[field] === "string" && !text(args[field]))) {
      return response(400, { error: `Missing required field: ${field}` });
    }
  }

  const origin = request.nextUrl.origin;
  const key = process.env.INTERNAL_API_KEY;
  if (!key) return response(500, { error: "INTERNAL_API_KEY is not configured" });

  const mcpResponse = await fetch(`${origin}/api/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `github-issue-${issueNumber}`,
      method: "tools/call",
      params: { name: "create_product", arguments: args },
    }),
    cache: "no-store",
  });

  const result = await mcpResponse.json().catch(() => ({ error: "Invalid MCP response" }));
  if (!mcpResponse.ok) return response(502, { error: "Stockly MCP request failed", details: result });

  return response(200, { issue: issueNumber, result });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
