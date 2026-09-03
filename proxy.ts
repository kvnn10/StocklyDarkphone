import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { prisma } from "@/prisma/client";
import { hasPermission, normalizeRole, type Resource } from "@/lib/security/rbac";

const PUBLIC_API = ["/api/auth/", "/api/health", "/api/client-portal/", "/api/portal/", "/api/supplier-portal/"];
const PUBLIC_PAGES = ["/login", "/register", "/client-portal", "/portal", "/supplier-portal"];
type Rule = { resource: Resource; action: string };
const RULES: Array<[string, Partial<Record<string, Rule>>]> = [
  ["/api/products", { GET: { resource: "products", action: "read" }, POST: { resource: "products", action: "create" }, PUT: { resource: "products", action: "update" }, DELETE: { resource: "products", action: "delete" } }],
  ["/api/sales", { POST: { resource: "sales", action: "create" } }],
  ["/api/service-orders", { GET: { resource: "service_orders", action: "read" }, POST: { resource: "service_orders", action: "create" }, PUT: { resource: "service_orders", action: "update" } }],
  ["/api/devices", { GET: { resource: "devices", action: "read" }, POST: { resource: "devices", action: "create" }, PUT: { resource: "devices", action: "update" }, DELETE: { resource: "devices", action: "delete" } }],
  ["/api/purchase-orders", { GET: { resource: "purchases", action: "read" }, POST: { resource: "purchases", action: "create" }, PATCH: { resource: "purchases", action: "receive" } }],
  ["/api/users", { GET: { resource: "users", action: "read" }, POST: { resource: "users", action: "create" }, PUT: { resource: "users", action: "update" }, PATCH: { resource: "users", action: "update" }, DELETE: { resource: "users", action: "delete" } }],
  ["/api/clients", { GET: { resource: "clients", action: "read" }, POST: { resource: "clients", action: "create" }, PUT: { resource: "clients", action: "update" }, PATCH: { resource: "clients", action: "update" }, DELETE: { resource: "clients", action: "delete" } }],
  ["/api/suppliers", { GET: { resource: "suppliers", action: "read" }, POST: { resource: "suppliers", action: "create" }, PUT: { resource: "suppliers", action: "update" }, PATCH: { resource: "suppliers", action: "update" }, DELETE: { resource: "suppliers", action: "delete" } }],
  ["/api/reports", { GET: { resource: "reports", action: "read" }, POST: { resource: "reports", action: "read" } }],
  ["/api/audit-logs", { GET: { resource: "audit", action: "read" } }],
  ["/api/approvals", { GET: { resource: "approvals", action: "read" }, POST: { resource: "approvals", action: "create" }, PATCH: { resource: "approvals", action: "approve" } }],
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
  const { pathname } = request.nextUrl;
  const method = request.method;
  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();
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
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico" || PUBLIC_PAGES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return NextResponse.next();
  const token = request.cookies.get("session_id")?.value;
  if (!token || token === "null" || token === "undefined") return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, request.url));
  try {
    const decoded = jwt.verify(token, secret());
    if (typeof decoded !== "object" || decoded === null || typeof decoded.userId !== "string" || !decoded.userId) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, request.url));
    const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { id: true } });
    if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, request.url));
    return NextResponse.next();
  } catch { return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, request.url)); }
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
