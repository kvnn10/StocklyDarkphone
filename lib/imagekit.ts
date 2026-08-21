/**
 * Legacy media utility compatibility layer.
 *
 * Storage was migrated from ImageKit to Vercel Blob. Keep these exported
 * names temporarily so older API routes/components continue compiling while
 * the database fields imageFileId/qrCodeFileId remain unchanged.
 */

export {
  generateQRCodeDataURL,
  generateAndUploadQRCode,
  uploadProductImageToBlob as uploadProductImageToImageKit,
  deleteProductImageFromBlob as deleteProductImageFromImageKit,
  deleteQRCodeFromBlob as deleteQRCodeFromImageKit,
  cleanupProductMediaFromBlob as cleanupProductMediaFromImageKit,
} from "@/lib/blob";
