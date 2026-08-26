/**
 * Product validation schemas
 * Zod schemas used by product forms and API; productSchema for form, createProductBodySchema/updateProductBodySchema for API routes.
 * calculateProductStatus() derives "available" | "stock_low" | "stock_out" from quantity and reservedQuantity.
 */

import { z } from "zod";
import type { ProductStatus } from "@/types";

const productSkuSchema = z
  .string()
  .min(1, "SKU is required")
  .regex(/^[a-zA-Z0-9-_]+$/, "SKU must be alphanumeric");

const productApiNameSchema = z
  .string()
  .min(1, "Product name is required")
  .max(100, "Product name must be 100 characters or less");

const productStatusSchema = z.enum(["Available", "Stock Low", "Stock Out"]);

const optionalImageUrlSchema = z
  .string()
  .url("Invalid image URL")
  .optional()
  .or(z.literal(""));

const optionalExpirationDateSchema = z
  .string()
  .optional()
  .or(z.literal(""))
  .or(z.null());

const nonNegativeMoneySchema = z.number().nonnegative("Price cannot be negative");

/**
 * Product form validation schema
 * Used for creating and updating products
 */
export const productSchema = z.object({
  productName: productApiNameSchema,
  sku: productSkuSchema,
  quantity: z.preprocess(
    (val) => {
      if (val === "" || val === null || val === undefined) return 0;
      const num = typeof val === "string" ? Number(val) : val;
      return isNaN(num as number) ? 0 : num;
    },
    z
      .number()
      .int("Quantity must be an integer")
      .nonnegative("Quantity cannot be negative"),
  ),
  purchasePrice: z.preprocess(
    (val) => {
      if (val === "" || val === null || val === undefined) return 0;
      const num = typeof val === "string" ? Number(val) : val;
      return isNaN(num as number) ? 0 : num;
    },
    nonNegativeMoneySchema,
  ),
  price: z.preprocess(
    (val) => {
      if (val === "" || val === null || val === undefined) return 0;
      const num = typeof val === "string" ? Number(val) : val;
      return isNaN(num as number) ? 0 : num;
    },
    nonNegativeMoneySchema,
  ),
  imageUrl: optionalImageUrlSchema,
  imageFileId: z.string().optional(),
  expirationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Use YYYY-MM-DD format")
    .optional()
    .or(z.literal("")),
});

/**
 * Product form data type inferred from schema
 */
export type ProductFormData = z.infer<typeof productSchema>;

/**
 * Form submit schema — RHF fields plus category/supplier from separate state
 */
export const productFormSubmitSchema = productSchema.extend({
  categoryId: z.string().min(1, "Category is required"),
  supplierId: z.string().min(1, "Supplier is required"),
});

/**
 * API request body for POST /api/products (userId from session only)
 * purchasePrice defaults to 0 for backward-compatible imports/API clients.
 */
export const createProductBodySchema = z.object({
  name: productApiNameSchema,
  sku: productSkuSchema,
  purchasePrice: nonNegativeMoneySchema.default(0),
  price: nonNegativeMoneySchema,
  quantity: z.number().int().nonnegative("Quantity cannot be negative"),
  status: productStatusSchema,
  categoryId: z.string().min(1, "Category is required"),
  supplierId: z.string().min(1, "Supplier is required"),
  imageUrl: optionalImageUrlSchema.optional(),
  imageFileId: z.string().optional(),
  expirationDate: optionalExpirationDateSchema.optional(),
});

/**
 * Product creation input validation schema (includes userId for import/bulk flows)
 */
export const createProductSchema = createProductBodySchema.extend({
  userId: z.string().min(1),
});

/**
 * API request body for PUT /api/products
 */
export const updateProductBodySchema = z.object({
  id: z.string().min(1, "Product ID is required"),
  name: productApiNameSchema.optional(),
  sku: productSkuSchema.optional(),
  purchasePrice: nonNegativeMoneySchema.optional(),
  price: nonNegativeMoneySchema.optional(),
  quantity: z.number().int().nonnegative("Quantity cannot be negative").optional(),
  status: productStatusSchema.optional(),
  categoryId: z.string().min(1, "Category is required").optional(),
  supplierId: z.string().min(1, "Supplier is required").optional(),
  imageUrl: optionalImageUrlSchema.optional(),
  imageFileId: z.string().optional(),
  expirationDate: optionalExpirationDateSchema.optional(),
});

/**
 * Product update input validation schema (alias for API/import compatibility)
 */
export const updateProductSchema = updateProductBodySchema;

/** POST /api/products/qr-code */
export const generateProductQrCodeBodySchema = z.object({
  productId: z.string().min(1, "Product ID is required"),
});

/**
 * Calculate product status based on quantity
 * @param quantity - Product quantity
 * @returns ProductStatus
 */
export const calculateProductStatus = (quantity: number): ProductStatus => {
  if (quantity > 20) return "Available";
  if (quantity > 0 && quantity <= 20) return "Stock Low";
  return "Stock Out";
};
