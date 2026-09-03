import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { prisma } from "@/prisma/client";
import { hasPermission, normalizeRole, type Resource } from "@/lib/security/rbac";

const PUBLIC = ["/api/auth/", "/api/health", "/api/client-portal/", "/api/portal/", "/api/supplier-portal/"];
type Rule = { resource: Resource; action: string };
const RULES: Array<[string, Partial<Record<string, Rule>>]> = [
  ["/api/products", { GET: { resource: "products", action: "read" }, POST: { resource: "products", action: "create" }, PUT: { resource: "products", action: "update" }, DELETE: { resource: "products", action: "delete" } }],
  ["/api/sales", { POST: { resource: "sales", action: "create" } }],
  ["/api/service-orders", { GET: { resource: "service_orders", action: "read" }, POST: { resource: "service_orders", action: "create" }, PUT: { resource: "service_orders", action: "update" } }],
  ["/api/devices", { GET: { resource: "devices", action: "read" }, POST: { resource: "devices", action: "create" }, PUT: { resource: "devices", action: "update" }, DELETE: { resource: "devices", action: "delete" } }],
  ["/api/purchase-orders", { GET: { resource: "purchases", action: "read" }, POST: { resource: "purchases", action: "create" }, PATCH: { resource: "purchases", action: "receive" } }],
  ["/api/users", { GET: { resource: "users", action: "read" }, POST: { resource: "users", action: "create" }, PUT: { resource: "users", action: "update" }, PATCH: { resource: "users", action: "update" }, DELETE: { resource: "users", action: "delete" } }],
  ["/api/clients", { GET: { resource: "devices", action: "read" }, POST: { resource: "devices", action: "create" }, PUT: { resource: "devices", action: "update" }, PATCH: { resource: "devices", action: "update" }, DELETE: { resource: "devices", action: "delete" } }],
  ["/api/suppliers", { GET: { resource: "purchases", action: "read" }, POST: { resource: "purchases", action: "create" }, PUT: { resource: "purchases", action: "update" }, PATCH: { resource: "purchases", action: "update" }, DELETE: { resource: "purchases", action: "update" } }],
  ["/api/reports", { GET: { resource: "reports", action: "read" }, POST: { resource: "reports", action: "read" } }],
  ["/api/audit-logs", { GET: { resource: "audit", action: "read" } }],
  ["/api/inventory", { GET: { resource: "products", action: "read" }, POST: { resource: "products", action: "adjust_stock" }, PUT: { resource: "products", action: "adjust_stock" }, PATCH: { resource: "products", action: "adjust_stock" } }],
  ["/api/inventory-movements", { GET: { resource: "products", action: "read" }, POST: { resource: "products", action: "adjust_stock" } }],
  ["/api/inventory-counts", { GET: { resource: "products", action: "read" }, POST: { resource: "products", action: "adjust_stock" }, PATCH: { resource: "products", action: "adjust_stock" } }],
  ["/api/stock-transfers", { GET: { resource: "products", action: "read" }, POST: { resource: "products", action: "adjust_stock" }, PATCH: { resource: "products", action: "adjust_stock" } }],
  ["/api/stock-allocations", { GET: { resource: "products", action: "read" }, POST: { resource: "products", action: "adjust_stock" }, PATCH: { resource: "products", action: "adjust_stock" } }],
  ["/api/cash", { GET: { resource: "finance", action: "read" }, POST: { resource: "finance", action: "create_payment" }, PATCH: { resource: "finance", action: "close_cash" } }],
  ["/api/payments", { GET: { resource: "finance", action: "read" }, POST: { resource: "finance", action: "create_payment" }, PATCH: { resource: "finance", action: "create_payment" } }],
  ["/api/finance", { GET: { resource: "finance", action: "read" }, POST: { resource: "finance", action: "create_payment" }, PATCH: { resource: "finance", action: "create_payment" } }],
];
function secret() { const value = process.env.JWT_SECRET?.trim(); if (!value) throw new Error("JWT_SECRET is required"); return value; }
function match(pathname: string, method: string) { for (const [prefix, methods] of RULES) if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return methods[method] ?? null; return null; }
export async function proxy(request: NextRequest) {
  const { pathname, method } = request.nextUrl;
  if (!pathname.startsWith("/api/") || PUBLIC.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();
  const rule = match(pathname, method);
  if (!rule) return NextResponse.next();
  const token = request.cookies.get("session_id")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const decoded = jwt.verify(token, secret());
    if (typeof decoded !== "object" || decoded === null || typeof decoded.userId !== "string" || !decoded.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { id: true, role: true } });
    const role = user ? normalizeRole(user.role) : null;
    if (!role || !hasPermission(role, rule.resource, rule.action)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.next();
  } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
}
export const config = { matcher: ["/api/:path*"] };
