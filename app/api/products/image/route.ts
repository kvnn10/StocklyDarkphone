/**
 * Product Image Upload API Route Handler
 * Handles product image uploads to Vercel Blob.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import {
  uploadProductImageToBlob,
  deleteProductImageFromBlob,
} from "@/lib/blob";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { scheduleInvalidateProductCaches } from "@/lib/cache";

/**
 * POST /api/products/image
 * Upload a product image to Vercel Blob.
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.standard,
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const sku = formData.get("sku") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 },
      );
    }

    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        {
          error:
            "Invalid file type. Only JPEG, PNG, and WebP images are allowed.",
        },
        { status: 400 },
      );
    }

    // Vercel Functions have a 4.5 MB request-body limit for server uploads.
    const maxSize = 4 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File size exceeds 4MB limit" },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = sku
      ? `product-${sku}-${Date.now()}`
      : `product-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9-_.]/g, "_")}`;

    const result = await uploadProductImageToBlob(
      buffer,
      fileName,
      file.type,
    );

    await scheduleInvalidateProductCaches();
    logger.info("Product image uploaded successfully", {
      userId: session.id,
      sku,
      fileId: result.fileId,
    });

    return NextResponse.json({
      success: true,
      imageUrl: result.url,
      imageFileId: result.fileId,
    });
  } catch (error) {
    logger.error("Error uploading product image:", error);
    return NextResponse.json(
      {
        error: "Failed to upload image",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/products/image
 * Delete a product image from Vercel Blob.
 */
export async function DELETE(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(
      request,
      defaultRateLimits.standard,
    );
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json(
        { error: "File ID is required" },
        { status: 400 },
      );
    }

    await deleteProductImageFromBlob(fileId);
    await scheduleInvalidateProductCaches();
    logger.info("Product image deleted successfully", {
      userId: session.id,
      fileId,
    });

    return NextResponse.json({
      success: true,
      message: "Image deleted successfully",
    });
  } catch (error) {
    logger.error("Error deleting product image:", error);
    return NextResponse.json(
      {
        error: "Failed to delete image",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
