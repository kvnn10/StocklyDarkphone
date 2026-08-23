/**
 * Internal bulk product creation API.
 * POST /api/admin/products
 * Authorization: Bearer ${INTERNAL_API_KEY}
 *
 * Category and supplier can be supplied by ID or by their natural name.
 * Names are resolved against records belonging to the supplied admin user,
 * case-insensitively. Maximum 100 products per request.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import { createAuditLog } from "@/prisma/audit-log";
import { invalidateOnProductChange } from "@/lib/cache";
import { calculateProductStatus, createProductBodySchema } from "@/lib/validations/product";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";

const MAX_PRODUCTS_PER_REQUEST = 100;

function isValidInternalKey(request: NextRequest): boolean {
  const configuredKey = process.env.INTERNAL_API_KEY;
  return Boolean(configuredKey) && request.headers.get("authorization") === `Bearer ${configuredKey}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function resolveReference(kind: "category" | "supplier", value: unknown, ownerId: string) {
  const nameOrId = text(value);
  if (!nameOrId) return { id: null as string | null, error: `${kind} is required` };

  if (kind === "category") {
    const byId = await prisma.category.findFirst({
      where: { id: nameOrId, userId: ownerId },
      select: { id: true },
    });
    if (byId) return { id: byId.id, error: undefined };

    const matches = await prisma.category.findMany({
      where: { userId: ownerId, name: { equals: nameOrId, mode: "insensitive" } },
      select: { id: true },
      take: 2,
    });
    if (matches.length === 1) return { id: matches[0].id, error: undefined };
    if (matches.length > 1) return { id: null as string | null, error: `Multiple ${kind}s match "${nameOrId}"; use the ID to disambiguate` };
    return { id: null as string | null, error: `${kind} "${nameOrId}" not found for this admin` };
  }

  const byId = await prisma.supplier.findFirst({
    where: { id: nameOrId, userId: ownerId },
    select: { id: true },
  });
  if (byId) return { id: byId.id, error: undefined };

  const matches = await prisma.supplier.findMany({
    where: { userId: ownerId, name: { equals: nameOrId, mode: "insensitive" } },
    select: { id: true },
    take: 2,
  });
  if (matches.length === 1) return { id: matches[0].id, error: undefined };
  if (matches.length > 1) return { id: null as string | null, error: `Multiple ${kind}s match "${nameOrId}"; use the ID to disambiguate` };
  return { id: null as string | null, error: `${kind} "${nameOrId}" not found for this admin` };
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.INTERNAL_API_KEY) return NextResponse.json({ error: "Internal product import is not configured" }, { status: 503 });
    if (!isValidInternalKey(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.strict);
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const ownerEmail = text(body?.ownerEmail);
    const products = Array.isArray(body?.products) ? body.products : null;
    if (!ownerEmail || !products) return NextResponse.json({ error: "ownerEmail and products[] are required" }, { status: 400 });
    if (products.length === 0) return NextResponse.json({ error: "products[] cannot be empty" }, { status: 400 });
    if (products.length > MAX_PRODUCTS_PER_REQUEST) return NextResponse.json({ error: `A maximum of ${MAX_PRODUCTS_PER_REQUEST} products can be imported per request` }, { status: 413 });

    const owner = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true, email: true, name: true, role: true } });
    if (!owner || owner.role !== "admin") return NextResponse.json({ error: "ownerEmail must belong to an admin user" }, { status: 403 });

    const results: Array<{ index: number; status: "created" | "skipped" | "failed"; id?: string; sku?: string; error?: string }> = [];

    for (let index = 0; index < products.length; index += 1) {
      const raw = products[index];
      if (!raw || typeof raw !== "object") {
        results.push({ index, status: "failed", error: "Product must be an object" });
        continue;
      }

      const category = await resolveReference("category", raw.categoryId ?? raw.category, owner.id);
      const supplier = await resolveReference("supplier", raw.supplierId ?? raw.supplier, owner.id);
      if (category.error || supplier.error) {
        results.push({ index, status: "failed", sku: typeof raw.sku === "string" ? raw.sku : undefined, error: [category.error, supplier.error].filter(Boolean).join("; ") });
        continue;
      }

      const candidate = { ...raw, categoryId: category.id, supplierId: supplier.id, status: raw.status ?? (typeof raw.quantity === "number" ? calculateProductStatus(raw.quantity) : undefined) };
      const validation = createProductBodySchema.safeParse(candidate);
      if (!validation.success) {
        results.push({ index, status: "failed", sku: typeof raw.sku === "string" ? raw.sku : undefined, error: validation.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ") });
        continue;
      }

      const data = validation.data;
      try {
        const existingProduct = await prisma.product.findUnique({ where: { sku: data.sku }, select: { id: true } });
        if (existingProduct) {
          results.push({ index, status: "skipped", id: existingProduct.id, sku: data.sku, error: "SKU already exists" });
          continue;
        }

        const [categoryRecord, supplierRecord] = await Promise.all([
          prisma.category.findFirst({ where: { id: data.categoryId, userId: owner.id }, select: { id: true } }),
          prisma.supplier.findFirst({ where: { id: data.supplierId, userId: owner.id }, select: { id: true } }),
        ]);
        if (!categoryRecord || !supplierRecord) {
          results.push({ index, status: "failed", sku: data.sku, error: !categoryRecord ? "Category not found for this admin" : "Supplier not found for this admin" });
          continue;
        }

        const product = await prisma.product.create({
          data: {
            name: data.name,
            sku: data.sku,
            price: data.price,
            quantity: BigInt(data.quantity),
            status: data.status,
            categoryId: data.categoryId,
            supplierId: data.supplierId,
            userId: owner.id,
            createdBy: owner.id,
            updatedAt: null,
            imageUrl: data.imageUrl || null,
            imageFileId: data.imageFileId || null,
            expirationDate: data.expirationDate ? new Date(data.expirationDate) : null,
          },
        });

        createAuditLog({
          userId: owner.id,
          action: "create",
          entityType: "product",
          entityId: product.id,
          details: { productName: product.name, sku: product.sku, source: "internal-bulk-api" },
          ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || undefined,
          userAgent: request.headers.get("user-agent") || undefined,
        }).catch(() => {});

        results.push({ index, status: "created", id: product.id, sku: product.sku });
      } catch (error) {
        logger.error("Failed to create product during internal import", { index, sku: data.sku, error });
        results.push({ index, status: "failed", sku: data.sku, error: error instanceof Error ? error.message : "Unknown error" });
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;
    if (created > 0) await invalidateOnProductChange();

    return NextResponse.json({ success: failed === 0, owner: { id: owner.id, email: owner.email, name: owner.name }, total: products.length, created, skipped, failed, results });
  } catch (error) {
    logger.error("Error in internal bulk product creation:", error);
    return NextResponse.json({ error: "Failed to process product import" }, { status: 500 });
  }
}
