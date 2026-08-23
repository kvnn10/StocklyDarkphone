/**
 * Internal bulk product creation API.
 *
 * POST /api/admin/products
 * Authorization: Bearer ${INTERNAL_API_KEY}
 *
 * This endpoint is intentionally separate from /api/products so automated
 * imports can create products without exposing the database connection or
 * requiring a browser session.
 *
 * Body:
 * {
 *   "ownerEmail": "admin@example.com",
 *   "products": [
 *     {
 *       "name": "iPhone 15 Pro Max Back Glass",
 *       "sku": "IPH15PM-BG",
 *       "price": 150000,
 *       "quantity": 10,
 *       "status": "Stock Low",
 *       "categoryId": "...",
 *       "supplierId": "..."
 *     }
 *   ]
 * }
 *
 * Maximum 100 products per request. Existing SKUs are reported as skipped.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import { createAuditLog } from "@/prisma/audit-log";
import { invalidateOnProductChange } from "@/lib/cache";
import {
  calculateProductStatus,
  createProductBodySchema,
} from "@/lib/validations/product";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";

const MAX_PRODUCTS_PER_REQUEST = 100;

function isValidInternalKey(request: NextRequest): boolean {
  const configuredKey = process.env.INTERNAL_API_KEY;
  if (!configuredKey) return false;

  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${configuredKey}`;
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.INTERNAL_API_KEY) {
      logger.error("INTERNAL_API_KEY is not configured");
      return NextResponse.json(
        { error: "Internal product import is not configured" },
        { status: 503 },
      );
    }

    if (!isValidInternalKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.strict,
    );
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const ownerEmail =
      typeof body?.ownerEmail === "string" ? body.ownerEmail.trim() : "";
    const products = Array.isArray(body?.products) ? body.products : null;

    if (!ownerEmail || !products) {
      return NextResponse.json(
        { error: "ownerEmail and products[] are required" },
        { status: 400 },
      );
    }

    if (products.length === 0) {
      return NextResponse.json(
        { error: "products[] cannot be empty" },
        { status: 400 },
      );
    }

    if (products.length > MAX_PRODUCTS_PER_REQUEST) {
      return NextResponse.json(
        {
          error: `A maximum of ${MAX_PRODUCTS_PER_REQUEST} products can be imported per request`,
        },
        { status: 413 },
      );
    }

    const owner = await prisma.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true, email: true, name: true, role: true },
    });

    if (!owner || owner.role !== "admin") {
      return NextResponse.json(
        { error: "ownerEmail must belong to an admin user" },
        { status: 403 },
      );
    }

    const results: Array<{
      index: number;
      status: "created" | "skipped" | "failed";
      id?: string;
      sku?: string;
      error?: string;
    }> = [];

    for (let index = 0; index < products.length; index += 1) {
      const raw = products[index];
      const candidate =
        raw && typeof raw === "object"
          ? {
              ...raw,
              status:
                raw.status ??
                (typeof raw.quantity === "number"
                  ? calculateProductStatus(raw.quantity)
                  : undefined),
            }
          : raw;

      const validation = createProductBodySchema.safeParse(candidate);

      if (!validation.success) {
        results.push({
          index,
          status: "failed",
          error: validation.error.errors
            .map((error) => `${error.path.join(".")}: ${error.message}`)
            .join("; "),
        });
        continue;
      }

      const data = validation.data;

      try {
        const existingProduct = await prisma.product.findUnique({
          where: { sku: data.sku },
          select: { id: true },
        });

        if (existingProduct) {
          results.push({
            index,
            status: "skipped",
            id: existingProduct.id,
            sku: data.sku,
            error: "SKU already exists",
          });
          continue;
        }

        const [category, supplier] = await Promise.all([
          prisma.category.findFirst({
            where: { id: data.categoryId, userId: owner.id },
            select: { id: true },
          }),
          prisma.supplier.findFirst({
            where: { id: data.supplierId, userId: owner.id },
            select: { id: true },
          }),
        ]);

        if (!category) {
          results.push({
            index,
            status: "failed",
            sku: data.sku,
            error: "Category not found for this admin",
          });
          continue;
        }

        if (!supplier) {
          results.push({
            index,
            status: "failed",
            sku: data.sku,
            error: "Supplier not found for this admin",
          });
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
            expirationDate: data.expirationDate
              ? new Date(data.expirationDate)
              : null,
          },
        });

        createAuditLog({
          userId: owner.id,
          action: "create",
          entityType: "product",
          entityId: product.id,
          details: {
            productName: product.name,
            sku: product.sku,
            source: "internal-bulk-api",
          },
          ipAddress:
            request.headers.get("x-forwarded-for")?.split(",")[0] ||
            request.headers.get("x-real-ip") ||
            undefined,
          userAgent: request.headers.get("user-agent") || undefined,
        }).catch(() => {});

        results.push({
          index,
          status: "created",
          id: product.id,
          sku: product.sku,
        });
      } catch (error) {
        logger.error("Failed to create product during internal import", {
          index,
          sku: data.sku,
          error,
        });
        results.push({
          index,
          status: "failed",
          sku: data.sku,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const created = results.filter((result) => result.status === "created").length;
    const skipped = results.filter((result) => result.status === "skipped").length;
    const failed = results.filter((result) => result.status === "failed").length;

    if (created > 0) {
      await invalidateOnProductChange();
    }

    return NextResponse.json({
      success: failed === 0,
      owner: {
        id: owner.id,
        email: owner.email,
        name: owner.name,
      },
      total: products.length,
      created,
      skipped,
      failed,
      results,
    });
  } catch (error) {
    logger.error("Error in internal bulk product creation:", error);
    return NextResponse.json(
      { error: "Failed to process product import" },
      { status: 500 },
    );
  }
}
