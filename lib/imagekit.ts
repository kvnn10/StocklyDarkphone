/**
 * Legacy media utility compatibility layer.
 *
 * Storage was migrated from ImageKit to Vercel Blob. The old export names are
 * intentionally kept so existing product routes and database cleanup logic do
 * not need a breaking migration.
 */

import {
  uploadProductImageToBlob,
  deleteProductImageFromBlob,
  generateQRCodeDataURL,
  generateAndUploadQRCode as generateAndUploadQRCodeToBlob,
  deleteQRCodeFromBlob,
  cleanupProductMediaFromBlob,
} from "@/lib/blob";

export { generateQRCodeDataURL };

/** @deprecated Use uploadProductImageToBlob. */
export async function uploadProductImageToImageKit(
  file: string | Buffer,
  fileName: string,
  folder: string = "stock-inventory/products",
): Promise<{ url: string; fileId: string }> {
  return uploadProductImageToBlob(file, fileName, "image/jpeg", folder);
}

/** @deprecated Use deleteProductImageFromBlob. */
export async function deleteProductImageFromImageKit(
  fileId: string,
): Promise<void> {
  return deleteProductImageFromBlob(fileId);
}

/** @deprecated Use generateAndUploadQRCode from @/lib/blob. */
export async function generateAndUploadQRCode(
  data: string,
  fileName: string,
  size: number = 200,
  folder: string = "stock-inventory/qr-codes",
): Promise<{ url: string; fileId: string }> {
  return generateAndUploadQRCodeToBlob(data, fileName, size, folder);
}

/** @deprecated Use deleteQRCodeFromBlob. */
export async function deleteQRCodeFromImageKit(fileId: string): Promise<void> {
  return deleteQRCodeFromBlob(fileId);
}

/** @deprecated Use Vercel Blob directly. Kept for backwards compatibility. */
export async function uploadQRCodeToImageKit(
  file: string | Buffer,
  fileName: string,
  folder: string = "stock-inventory/qr-codes",
): Promise<{ url: string; fileId: string }> {
  return uploadProductImageToBlob(
    file,
    `${fileName.replace(/[^a-zA-Z0-9-_]/g, "_")}.png`,
    "image/png",
    folder,
  );
}

/** @deprecated Use cleanupProductMediaFromBlob. */
export async function cleanupProductMediaFromImageKit(product: {
  qrCodeFileId?: string | null;
  imageFileId?: string | null;
}): Promise<void> {
  return cleanupProductMediaFromBlob(product);
}
