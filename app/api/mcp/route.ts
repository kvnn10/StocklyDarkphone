/**
 * Stockly MCP endpoint.
 *
 * Exposes a small, authenticated MCP surface so an MCP-compatible AI client
 * can create products without direct database access.
 *
 * Endpoint: POST /api/mcp
 * Auth: Authorization: Bearer ${INTERNAL_API_KEY}
 * Owner: MCP_OWNER_EMAIL (configured in Vercel)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { createAuditLog } from "@/prisma/audit-log";
import { invalidateOnProductChange } from "@/lib/cache";
import { calculateProductStatus, createProductBodySchema } from "@/lib/validations/product";

const SERVER_INFO = { name: "stockly-darkphone", version: "1.0.0" };
const PROTOCOL_VERSION = "2025-11-25";

const CREATE_PRODUCT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Product name" },
    sku: { type: "string", description: "Unique SKU" },
    price: { type: "number", minimum: 0, description: "Sale price" },
    quantity: { type: "integer", minimum: 0, description: "Initial stock quantity" },
    category: { type: "string", description: "Existing category name or ID" },
    supplier: { type: "string", description: "Existing supplier name or ID" },
    imageUrl: { type: "string", description: "Optional product image URL" },
    expirationDate: { type: "string", description: "Optional YYYY-MM-DD expiration date" },
  },
  required: ["name", "sku", "price", "quantity", "category", "supplier"],
  additionalProperties: false,
};

const TOOLS = [{
  name: "create_product",
  description: "Create one product in Stockly. Category and supplier are resolved automatically by existing name or ID. Duplicate SKUs are not created.",
  inputSchema: CREATE_PRODUCT_SCHEMA,
}];

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

function jsonRpc(id: JsonRpcRequest["id"], result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { status });
}
function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}
function authorized(request: NextRequest): boolean {
  const key = process.env.INTERNAL_API_KEY;
  return Boolean(key) && request.headers.get("authorization") === `Bearer ${key}`;
}
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

async function resolveReference(kind: "category" | "supplier", value: unknown, ownerId: string) {
  const nameOrId = text(value);
  if (!nameOrId) return { id: null as string | null, error: `${kind} is required` };

  if (kind === "category") {
    const byId = await prisma.category.findFirst({ where: { id: nameOrId, userId: ownerId }, select: { id: true, name: true } });
    if (byId) return { id: byId.id, name: byId.name, error: undefined };
    const matches = await prisma.category.findMany({ where: { userId: ownerId, name: { equals: nameOrId, mode: "insensitive" } }, select: { id: true, name: true }, take: 2 });
    const match = matches[0];
    if (matches.length === 1 && match) return { id: match.id, name: match.name, error: undefined };
    if (matches.length > 1) return { id: null as string | null, error: `Multiple categories match "${nameOrId}"; use the ID to disambiguate` };
    return { id: null as string | null, error: `category "${nameOrId}" not found for this admin` };
  }

  const byId = await prisma.supplier.findFirst({ where: { id: nameOrId, userId: ownerId }, select: { id: true, name: true } });
  if (byId) return { id: byId.id, name: byId.name, error: undefined };
  const matches = await prisma.supplier.findMany({ where: { userId: ownerId, name: { equals: nameOrId, mode: "insensitive" } }, select: { id: true, name: true }, take: 2 });
  const match = matches[0];
  if (matches.length === 1 && match) return { id: match.id, name: match.name, error: undefined };
  if (matches.length > 1) return { id: null as string | null, error: `Multiple suppliers match "${nameOrId}"; use the ID to disambiguate` };
  return { id: null as string | null, error: `supplier "${nameOrId}" not found for this admin` };
}

async function createProduct(args: Record<string, unknown>) {
  const ownerEmail = text(process.env.MCP_OWNER_EMAIL);
  if (!ownerEmail) throw new Error("MCP_OWNER_EMAIL is not configured in Vercel");
  const owner = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true, email: true, name: true, role: true } });
  if (!owner || owner.role !== "admin") throw new Error("MCP_OWNER_EMAIL must belong to an admin user");

  const category = await resolveReference("category", args.category, owner.id);
  const supplier = await resolveReference("supplier", args.supplier, owner.id);
  if (category.error || supplier.error) throw new Error([category.error, supplier.error].filter(Boolean).join("; "));

  const quantity = args.quantity;
  const candidate = { name: args.name, sku: args.sku, price: args.price, quantity, status: typeof quantity === "number" ? calculateProductStatus(quantity) : undefined, categoryId: category.id, supplierId: supplier.id, imageUrl: args.imageUrl, expirationDate: args.expirationDate };
  const validation = createProductBodySchema.safeParse(candidate);
  if (!validation.success) throw new Error(validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "));
  const data = validation.data;

  const existing = await prisma.product.findUnique({ where: { sku: data.sku }, select: { id: true, name: true, sku: true } });
  if (existing) return { status: "skipped", reason: "SKU already exists", product: existing };

  const product = await prisma.product.create({ data: { name: data.name, sku: data.sku, price: data.price, quantity: BigInt(data.quantity), status: data.status, categoryId: data.categoryId, supplierId: data.supplierId, userId: owner.id, createdBy: owner.id, updatedAt: null, imageUrl: data.imageUrl || null, imageFileId: data.imageFileId || null, expirationDate: data.expirationDate ? new Date(data.expirationDate) : null }, select: { id: true, name: true, sku: true, price: true, quantity: true, status: true } });

  await createAuditLog({ userId: owner.id, action: "create", entityType: "product", entityId: product.id, details: { productName: product.name, sku: product.sku, source: "mcp", category: category.name, supplier: supplier.name } }).catch(() => undefined);
  await invalidateOnProductChange();
  return { status: "created", product: { ...product, quantity: product.quantity.toString() }, category: category.name, supplier: supplier.name };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: JsonRpcRequest;
  try { body = (await request.json()) as JsonRpcRequest; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const id = body.id ?? null;
  const method = body.method;
  if (body.jsonrpc !== "2.0" || !method) return jsonRpcError(id, -32600, "Invalid JSON-RPC request");
  if (method === "notifications/initialized") return new NextResponse(null, { status: 204 });
  if (method === "ping") return jsonRpc(id, {});
  if (method === "server/discover") return jsonRpc(id, { protocolVersion: "2026-07-28", serverInfo: SERVER_INFO, capabilities: { tools: {} } });
  if (method === "initialize") return jsonRpc(id, { protocolVersion: text(body.params?.protocolVersion) === PROTOCOL_VERSION ? PROTOCOL_VERSION : PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO, instructions: "Stockly product management. Use create_product to add inventory items." });
  if (method === "tools/list") return jsonRpc(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = text(body.params?.name);
    const args = body.params?.arguments && typeof body.params.arguments === "object" ? (body.params.arguments as Record<string, unknown>) : {};
    if (name !== "create_product") return jsonRpcError(id, -32601, `Unknown tool: ${name}`);
    try {
      const result = await createProduct(args);
      return jsonRpc(id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonRpc(id, { content: [{ type: "text", text: message }], isError: true });
    }
  }
  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

export async function GET() { return new NextResponse("Stockly MCP endpoint. Use POST with Streamable HTTP.", { status: 405, headers: { Allow: "POST" } }); }
