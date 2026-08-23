import { NextRequest, NextResponse } from "next/server";

const OWNER_LOGIN = "kvnn10";
const QUEUE_PREFIX = "automation/queue/";

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") || "";
  if (!path.startsWith(QUEUE_PREFIX) || !path.endsWith(".json")) {
    return fail(400, "Invalid queue path");
  }

  const contentsUrl = `https://api.github.com/repos/kvnn10/StocklyDarkphone/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "StocklyDarkphone",
  };

  const contentsResponse = await fetch(contentsUrl, { headers, cache: "no-store" });
  if (!contentsResponse.ok) return fail(404, "Queue file not found");

  const file = (await contentsResponse.json()) as { content?: string; encoding?: string; sha?: string };
  if (!file.content || file.encoding !== "base64") return fail(400, "Queue file has no readable content");

  const commitsUrl = `https://api.github.com/repos/kvnn10/StocklyDarkphone/commits?path=${encodeURIComponent(path)}&per_page=1`;
  const commitsResponse = await fetch(commitsUrl, { headers, cache: "no-store" });
  if (!commitsResponse.ok) return fail(502, "Unable to verify queue author");
  const commits = (await commitsResponse.json()) as Array<{ author?: { login?: string } | null }>;
  if (commits[0]?.author?.login !== OWNER_LOGIN) return fail(403, "Queue file was not created by the authorized GitHub account");

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(Buffer.from(file.content, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return fail(400, "Queue file must contain valid JSON");
  }

  const required = ["name", "sku", "price", "quantity", "category", "supplier"];
  for (const field of required) {
    if (args[field] === undefined || args[field] === null || (typeof args[field] === "string" && !String(args[field]).trim())) {
      return fail(400, `Missing required field: ${field}`);
    }
  }

  const key = process.env.INTERNAL_API_KEY;
  if (!key) return fail(500, "INTERNAL_API_KEY is not configured");

  const mcpResponse = await fetch(`${request.nextUrl.origin}/api/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `github-queue-${file.sha || path}`,
      method: "tools/call",
      params: { name: "create_product", arguments: args },
    }),
    cache: "no-store",
  });

  const result = await mcpResponse.json().catch(() => ({ error: "Invalid MCP response" }));
  if (!mcpResponse.ok) return fail(502, `Stockly MCP request failed: ${JSON.stringify(result)}`);

  // MCP returns application-level errors inside a successful JSON-RPC response.
  // Do not let the queue workflow delete a product that was not actually created.
  if (result?.result?.isError === true) {
    const message = result?.result?.content?.[0]?.text || "Stockly MCP returned an application error";
    return fail(422, `Stockly product creation failed: ${message}`);
  }

  return NextResponse.json({ path, result });
}
