/**
 * Vercel Blob media utility
 * Centralized storage for product images and QR codes.
 */

import { del, put } from "@vercel/blob";

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9-_.]/g, "_");
}

async function uploadToBlob(
  file: string | Buffer,
  fileName: string,
  folder: string,
  contentType: string,
): Promise<{ url: string; fileId: string }> {
  const safeName = safeFileName(fileName);
  const body =
    typeof file === "string" ? Buffer.from(file, "base64") : file;

  const blob = await put(`${folder}/${safeName}`, body, {
    access: "public",
    addRandomSuffix: true,
    contentType,
  });

  return {
    url: blob.url,
    // Keep the existing DB field name for backwards compatibility.
    // Vercel Blob accepts the URL directly when deleting a blob.
    fileId: blob.url,
  };
}

export async function uploadProductImageToBlob(
  file: string | Buffer,
  fileName: string,
  contentType: string = "image/jpeg",
  folder: string = "stock-inventory/products",
): Promise<{ url: string; fileId: string }> {
  try {
    return await uploadToBlob(file, fileName, folder, contentType);
  } catch (error) {
    throw new Error(
      `Failed to upload product image to Vercel Blob: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

export async function deleteProductImageFromBlob(fileId: string): Promise<void> {
  // Existing ImageKit IDs/URLs may still exist in older records.
  // Do not send those references to Vercel Blob's delete API.
  if (!fileId.includes("blob.vercel-storage.com")) return;

  try {
    await del(fileId);
  } catch (error) {
    throw new Error(
      `Failed to delete product image from Vercel Blob: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

export async function generateQRCodeDataURL(
  data: string,
  size: number = 200,
): Promise<string> {
  const QRCode = (await import("qrcode")).default;

  return QRCode.toDataURL(data, {
    width: size,
    margin: 2,
    color: {
      dark: "#000000",
      light: "#FFFFFF",
    },
  });
}

export async function generateAndUploadQRCode(
  data: string,
  fileName: string,
  size: number = 200,
  folder: string = "stock-inventory/qr-codes",
): Promise<{ url: string; fileId: string }> {
  const qrCodeDataURL = await generateQRCodeDataURL(data, size);
  const base64Data = qrCodeDataURL.split(",")[1];

  if (!base64Data) {
    throw new Error("Failed to generate QR code data");
  }

  return uploadToBlob(
    Buffer.from(base64Data, "base64"),
    `${fileName.replace(/[^a-zA-Z0-9-_]/g, "_")}.png`,
    folder,
    "image/png",
  );
}

export async function deleteQRCodeFromBlob(fileId: string): Promise<void> {
  if (!fileId.includes("blob.vercel-storage.com")) return;

  try {
    await del(fileId);
  } catch (error) {
    throw new Error(
      `Failed to delete QR code from Vercel Blob: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

export async function cleanupProductMediaFromBlob(product: {
  qrCodeFileId?: string | null;
  imageFileId?: string | null;
}): Promise<void> {
  if (product.qrCodeFileId) {
    await deleteQRCodeFromBlob(product.qrCodeFileId);
  }

  if (product.imageFileId) {
    await deleteProductImageFromBlob(product.imageFileId);
  }
}
