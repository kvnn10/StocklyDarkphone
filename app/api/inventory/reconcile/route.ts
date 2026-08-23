import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { logger } from "@/lib/logger";
import { reconcileInventory } from "@/lib/stock-allocation/reconcile-inventory";

const bodySchema = z.object({ repair: z.boolean().optional().default(false) });

/**
 * GET: audit stock consistency without changing data.
 * POST: audit and safely repair allocation-over-catalog mismatches.
 */
export async function GET(request: NextRequest) {
  return run(request, false);
}

export async function POST(request: NextRequest) {
  return run(request, true);
}

async function run(request: NextRequest, allowRepair: boolean) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;

    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.role ?? "client";
    if (allowRepair && role === "client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let repair = false;
    if (request.method === "POST") {
      let body: unknown = {};
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid request body", details: parsed.error.errors }, { status: 400 });
      }
      repair = parsed.data.repair;
    }

    if (repair && !allowRepair) repair = false;

    const result = await reconcileInventory(session.id, { repair });
    return NextResponse.json(result);
  } catch (error) {
    logger.error("Inventory reconciliation failed:", error);
    return NextResponse.json({ error: "Failed to reconcile inventory" }, { status: 500 });
  }
}
