/**
 * Product Detail API Route Handler
 * App Router route handler for individual product operations (GET)
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { authorizeRequest } from "@/lib/security/authorize";
import { logger } from "@/lib/logger";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { getProductDetailForPage } from "@/lib/server/product-detail-data";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;

    const authorization = await authorizeRequest(request, "products", "read");
    if (authorization.response) return authorization.response;
    const session = authorization.session;
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const transformedProduct = await getProductDetailForPage({ id: session.id, role: session.role }, id);
    if (!transformedProduct) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    return NextResponse.json(transformedProduct);
  } catch (error) {
    logger.error("Error fetching product:", error);
    return NextResponse.json({ error: "Failed to fetch product" }, { status: 500 });
  }
}
