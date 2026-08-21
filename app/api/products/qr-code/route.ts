/**
 * QR Code API Route Handler
 * Generates QR codes for products and uploads them to Vercel Blob.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import {
  generateAndUploadQRCode,
  deleteQRCodeFromBlob,
} from "@/lib/blob";
import { logger } from "@/lib/logger";
import { generateProductQrCodeBodySchema } from "@/lib/validations/product";
import { scheduleInvalidateProductCaches } from "@/lib/cache";
import { prisma } from "@/prisma/client";

/**
 * POST /api/products/qr-code
 * Generate QR code for a product and upload to Vercel Blob.
 * Body: { productId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validationResult = generateProductQrCodeBodySchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn("Invalid product QR code request", {
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        {
          error: "Invalid request body",
          details: validationResult.error.errors,
        },
        { status: 400 },
      );
    }

    const { productId } = validationResult.data;
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    if (product.userId !== session.id) {
      return NextResponse.json(
        { error: "Unauthorized to access this product" },
        { status: 403 },
      );
    }

    const qrCodeDataString = JSON.stringify({
      productId: product.id,
      sku: product.sku,
      name: product.name,
    });

    const oldFileId = product.qrCodeFileId;

    const qrCodeData = await generateAndUploadQRCode(
      qrCodeDataString,
      `product-${product.sku}`,
      200,
      "stock-inventory/qr-codes",
    );

    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        qrCodeUrl: qrCodeData.url,
        qrCodeFileId: qrCodeData.fileId,
      },
    });

    if (oldFileId) {
      try {
        await deleteQRCodeFromBlob(oldFileId);
        logger.debug(`Deleted old QR code file from Blob: ${oldFileId}`);
      } catch (deleteError) {
        logger.error(
          `Failed to delete old QR code from Blob: ${oldFileId}`,
          deleteError,
        );
      }
    }

    await scheduleInvalidateProductCaches();
    return NextResponse.json(
      {
        qrCodeUrl: updatedProduct.qrCodeUrl,
        productId: updatedProduct.id,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error("Error generating QR code:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate QR code",
      },
      { status: 500 },
    );
  }
}
