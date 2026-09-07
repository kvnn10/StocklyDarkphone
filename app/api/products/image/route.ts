/**
 * Product Media Upload API Route Handler
 * Uploads product images or videos to Vercel Blob.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import { uploadProductImageToBlob, deleteProductImageFromBlob } from "@/lib/blob";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { scheduleInvalidateProductCaches } from "@/lib/cache";

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"];
const MAX_SIZE = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const sku = formData.get("sku") as string | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "Tipo de archivo no válido. Usa JPEG, PNG, WebP, MP4, WebM o MOV." }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "El archivo supera el límite de 4 MB." }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = sku ? `product-${sku}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9-_.]/g, "_")}` : `product-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9-_.]/g, "_")}`;
    const result = await uploadProductImageToBlob(buffer, fileName, file.type);
    await scheduleInvalidateProductCaches();
    logger.info("Product media uploaded successfully", { userId: session.id, sku, fileId: result.fileId, contentType: file.type });
    return NextResponse.json({ success: true, imageUrl: result.url, imageFileId: result.fileId, mediaType: file.type.startsWith("video/") ? "video" : "image" });
  } catch (error) {
    logger.error("Error uploading product media:", error);
    return NextResponse.json({ error: "Failed to upload media", message: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const fileId = new URL(request.url).searchParams.get("fileId");
    if (!fileId) return NextResponse.json({ error: "File ID is required" }, { status: 400 });
    await deleteProductImageFromBlob(fileId);
    await scheduleInvalidateProductCaches();
    logger.info("Product media deleted successfully", { userId: session.id, fileId });
    return NextResponse.json({ success: true, message: "Media deleted successfully" });
  } catch (error) {
    logger.error("Error deleting product media:", error);
    return NextResponse.json({ error: "Failed to delete media", message: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
