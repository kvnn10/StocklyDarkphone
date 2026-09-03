/**
 * Products API Route Handler
 * GET: list products; POST: create product; PUT: update product; DELETE: delete/archive product.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { authorizeRequest } from "@/lib/security/authorize";
import { logger } from "@/lib/logger";
import { generateAndUploadQRCode, deleteQRCodeFromImageKit, deleteProductImageFromImageKit, cleanupProductMediaFromImageKit } from "@/lib/imagekit";
import { isImageKitNotFoundError } from "@/lib/imagekit-errors";
import { isPrismaRelationViolation } from "@/lib/api/prisma-errors";
import { getDeleteStrategy, isActiveOrderStatus } from "@/lib/products/delete-policy";
import { mergeProductListWhere } from "@/lib/products/product-query";
import { prisma } from "@/prisma/client";
import { getSupplierByUserId } from "@/prisma/supplier";
import { checkAndSendStockAlerts } from "@/lib/email/notifications";
import { getCache, setCache, cacheKeys, invalidateOnProductChange, scheduleAfterResponse, scheduleInvalidateStockAllocationCaches } from "@/lib/cache";
import { getStockAllocationsByProduct } from "@/prisma/stock-allocation";
import { planCatalogQuantityReconcile } from "@/lib/stock-allocation/catalog-quantity-reconcile";
import { applyCatalogQuantityReconcile } from "@/lib/stock-allocation/apply-catalog-quantity-reconcile";
import { enrichProductsWithCommittedQuantity } from "@/lib/products/enrich-product-committed-quantity";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { createAuditLog } from "@/prisma/audit-log";
import { createProductBodySchema, updateProductBodySchema } from "@/lib/validations/product";

export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const authorization = await authorizeRequest(request, "products", "read");
    if (authorization.response) return authorization.response;
    const session = authorization.session;
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const isSupplier = session.role === "supplier";
    let cacheKey: string;
    let productWhere: { userId: string } | { supplierId: string };
    if (isSupplier) {
      const supplier = await getSupplierByUserId(session.id);
      if (!supplier) return NextResponse.json([]);
      cacheKey = cacheKeys.products.list({ supplierId: supplier.id, withOwnerNames: true });
      productWhere = { supplierId: supplier.id };
    } else {
      cacheKey = cacheKeys.products.list({ userId: session.id });
      productWhere = { userId: session.id };
    }
    const cacheReadStartedAt = Date.now();
    const cachedProducts = await getCache<Array<{ committedQuantity?: number }>>(cacheKey);
    if (cachedProducts && cachedProducts.every((p) => typeof p.committedQuantity === "number" && "productOwnerImage" in p && "productOwnerEmail" in p && "supplierImage" in p)) return NextResponse.json(cachedProducts);
    const products = await prisma.product.findMany({ where: mergeProductListWhere(productWhere), orderBy: { createdAt: "desc" } });
    const { loadProductListPartyMaps, productListPartyFields } = await import("@/lib/server/product-list-party");
    const partyMaps = await loadProductListPartyMaps(products);
    const transformedProducts = await enrichProductsWithCommittedQuantity(products.map((product) => {
      const party = productListPartyFields(product, partyMaps);
      return { id: product.id, name: product.name, sku: product.sku, price: Number(product.price), purchasePrice: Number(product.purchasePrice ?? 0), quantity: Number(product.quantity), reservedQuantity: Number(product.reservedQuantity ?? 0), status: product.status, categoryId: product.categoryId, supplierId: product.supplierId, category: party.category, supplier: party.supplier, userId: product.userId, createdBy: product.createdBy, updatedBy: product.updatedBy || null, createdAt: product.createdAt.toISOString(), updatedAt: product.updatedAt?.toISOString() || null, qrCodeUrl: product.qrCodeUrl || null, imageUrl: product.imageUrl || null, imageFileId: product.imageFileId || null, expirationDate: product.expirationDate?.toISOString() || null, productOwnerName: party.productOwnerName, productOwnerImage: party.productOwnerImage, productOwnerEmail: party.productOwnerEmail, supplierImage: party.supplierImage };
    }));
    await setCache(cacheKey, transformedProducts, 300, { fetchedAt: cacheReadStartedAt });
    return NextResponse.json(transformedProducts);
  } catch (error) { logger.error("Error fetching products:", error); return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const authorization = await authorizeRequest(request, "products", "create");
    if (authorization.response) return authorization.response;
    const session = authorization.session;
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.id;
    const validationResult = createProductBodySchema.safeParse(await request.json());
    if (!validationResult.success) return NextResponse.json({ error: "Invalid request body", details: validationResult.error.errors }, { status: 400 });
    const { name, sku, purchasePrice, price, quantity, status, categoryId, supplierId, imageUrl, imageFileId, expirationDate } = validationResult.data;
    if (await prisma.product.findUnique({ where: { sku } })) return NextResponse.json({ error: "SKU must be unique" }, { status: 400 });
    const product = await prisma.product.create({ data: { name, sku, purchasePrice, price, quantity: BigInt(quantity) as any, status, userId, createdBy: userId, categoryId, supplierId, imageUrl: imageUrl || null, imageFileId: imageFileId || null, expirationDate: expirationDate ? new Date(expirationDate) : null, createdAt: new Date(), updatedAt: null } });
    createAuditLog({ userId, action: "create", entityType: "product", entityId: product.id, details: { productName: product.name, sku: product.sku } }).catch(() => {});
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    generateAndUploadQRCode(JSON.stringify({ productId: product.id, sku: product.sku, name: product.name }), `product-${product.sku}`, 200, "/stock-inventory/qr-codes/").then(async (qrCodeData) => { await prisma.product.update({ where: { id: product.id }, data: { qrCodeUrl: qrCodeData.url, qrCodeFileId: qrCodeData.fileId } }); await invalidateOnProductChange(); }).catch((error) => logger.error("Failed to generate QR code for new product:", error));
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    checkAndSendStockAlerts({ name: product.name, quantity: Number(product.quantity), sku: product.sku, category: category?.name }, undefined, user?.email || undefined, user?.name || undefined, userId).catch((error) => logger.error("Failed to check and send stock alerts for new product:", error));
    await invalidateOnProductChange();
    return NextResponse.json({ id: product.id, name: product.name, sku: product.sku, price: Number(product.price), purchasePrice: Number(product.purchasePrice ?? 0), quantity: Number(product.quantity), status: product.status, categoryId: product.categoryId, supplierId: product.supplierId, category: category?.name || "Unknown", supplier: supplier?.name || "Unknown", userId: product.userId, createdBy: product.createdBy, updatedBy: product.updatedBy || null, createdAt: product.createdAt.toISOString(), updatedAt: product.updatedAt?.toISOString() || null, qrCodeUrl: product.qrCodeUrl || null }, { status: 201 });
  } catch (error) { logger.error("Error creating product:", error); return NextResponse.json({ error: "Failed to create product" }, { status: 500 }); }
}

export async function PUT(request: NextRequest) {
  try {
    const authorization = await authorizeRequest(request, "products", "update");
    if (authorization.response) return authorization.response;
    const session = authorization.session;
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const validationResult = updateProductBodySchema.safeParse(await request.json());
    if (!validationResult.success) return NextResponse.json({ error: "Invalid request body", details: validationResult.error.errors }, { status: 400 });
    const { id, name, sku, purchasePrice, price, quantity, status, categoryId, supplierId, imageUrl, imageFileId, expirationDate } = validationResult.data;
    const existingProduct = await prisma.product.findFirst({ where: mergeProductListWhere({ id, userId: session.id }) });
    if (!existingProduct) return NextResponse.json({ error: "Product not found or unauthorized" }, { status: 404 });
    const quantityChanged = quantity !== undefined && existingProduct.quantity !== BigInt(quantity);
    if (quantityChanged) { const stockAuthorization = await authorizeRequest(request, "products", "adjust_stock"); if (stockAuthorization.response) return stockAuthorization.response; }
    if (sku && sku !== existingProduct.sku && await prisma.product.findUnique({ where: { sku } })) return NextResponse.json({ error: "SKU must be unique" }, { status: 400 });
    if (imageUrl === "" && existingProduct.imageFileId) deleteProductImageFromImageKit(existingProduct.imageFileId).catch((error) => { if (!isImageKitNotFoundError(error)) logger.warn("Failed to delete old product image:", error); });
    const productUpdateData = { ...(name && { name }), ...(sku && { sku }), ...(purchasePrice !== undefined && { purchasePrice }), ...(price !== undefined && { price }), ...(status && { status }), ...(categoryId && { categoryId }), ...(supplierId && { supplierId }), ...(imageUrl !== undefined && { imageUrl: imageUrl === "" ? null : imageUrl }), ...(imageFileId !== undefined && { imageFileId: imageFileId === "" ? null : imageFileId }), ...(expirationDate !== undefined && { expirationDate: expirationDate === "" || expirationDate === null ? null : new Date(expirationDate) }), updatedBy: session.id, updatedAt: new Date() };
    let stockReconcile: any;
    if (quantityChanged) {
      const allocationRows = await getStockAllocationsByProduct(id);
      const reconcilePlan = planCatalogQuantityReconcile({ currentCatalog: Number(existingProduct.quantity), newCatalog: quantity, productReserved: Number(existingProduct.reservedQuantity ?? 0), allocations: allocationRows.map((row) => ({ id: row.id, quantity: Number(row.quantity), reservedQuantity: Number(row.reservedQuantity ?? 0), warehouseId: row.warehouseId })) });
      if (!reconcilePlan.ok) return NextResponse.json({ error: reconcilePlan.blockedReason, reservedCommitment: reconcilePlan.reservedCommitment, totalAllocated: reconcilePlan.totalAllocated, reducible: reconcilePlan.reducible, overage: reconcilePlan.overage }, { status: 409 });
      if (reconcilePlan.shrinkSteps.length > 0) stockReconcile = await applyCatalogQuantityReconcile({ productId: id, newCatalog: quantity, shrinkSteps: reconcilePlan.shrinkSteps, productUpdate: productUpdateData });
      else await prisma.product.update({ where: { id }, data: { ...productUpdateData, quantity: BigInt(quantity) as never } });
      await scheduleInvalidateStockAllocationCaches();
    } else await prisma.product.update({ where: { id }, data: productUpdateData });
    const product = await prisma.product.findUniqueOrThrow({ where: { id } });
    const fieldsUpdated: string[] = []; if (name && name !== existingProduct.name) fieldsUpdated.push("Name"); if (sku && sku !== existingProduct.sku) fieldsUpdated.push("SKU"); if (purchasePrice !== undefined && Number(existingProduct.purchasePrice ?? 0) !== purchasePrice) fieldsUpdated.push("Purchase Price"); if (price !== undefined && Number(existingProduct.price) !== price) fieldsUpdated.push("Sale Price"); if (quantityChanged) fieldsUpdated.push("Quantity"); if (status && status !== existingProduct.status) fieldsUpdated.push("Status"); if (categoryId && categoryId !== existingProduct.categoryId) fieldsUpdated.push("Category"); if (supplierId && supplierId !== existingProduct.supplierId) fieldsUpdated.push("Supplier"); if (imageUrl !== undefined) fieldsUpdated.push("Image"); if (expirationDate !== undefined) fieldsUpdated.push("Expiration Date");
    createAuditLog({ userId: session.id, action: "update", entityType: "product", entityId: product.id, details: { productName: product.name, ...(fieldsUpdated.length > 0 && { fieldsUpdated }) } }).catch(() => {});
    const category = await prisma.category.findUnique({ where: { id: product.categoryId } }); const supplier = await prisma.supplier.findUnique({ where: { id: product.supplierId } });
    if (sku || name) { const oldFileId = product.qrCodeFileId; generateAndUploadQRCode(JSON.stringify({ productId: product.id, sku: product.sku, name: product.name }), `product-${product.sku}`, 200, "/stock-inventory/qr-codes/").then(async (qrCodeData) => { await prisma.product.update({ where: { id: product.id }, data: { qrCodeUrl: qrCodeData.url, qrCodeFileId: qrCodeData.fileId } }); if (oldFileId) { try { await deleteQRCodeFromImageKit(oldFileId); } catch (error) { if (!isImageKitNotFoundError(error)) logger.warn(`Failed to delete old QR code from ImageKit: ${oldFileId}`, error); } } await invalidateOnProductChange(); }).catch((error) => logger.error("Failed to regenerate QR code for updated product:", error)); }
    const previousQuantity = Number(existingProduct.quantity), currentQuantity = Number(product.quantity); if (previousQuantity !== currentQuantity) { const user = await prisma.user.findUnique({ where: { id: session.id }, select: { email: true, name: true } }); checkAndSendStockAlerts({ name: product.name, quantity: currentQuantity, sku: product.sku, category: category?.name }, previousQuantity, user?.email || undefined, user?.name || undefined, session.id).catch((error) => logger.error("Failed to check and send stock alerts for updated product:", error)); }
    await invalidateOnProductChange();
    return NextResponse.json({ id: product.id, name: product.name, sku: product.sku, price: Number(product.price), purchasePrice: Number(product.purchasePrice ?? 0), quantity: Number(product.quantity), status: product.status, categoryId: product.categoryId, supplierId: product.supplierId, category: category?.name || "Unknown", supplier: supplier?.name || "Unknown", userId: product.userId, createdBy: product.createdBy, updatedBy: product.updatedBy || null, createdAt: product.createdAt.toISOString(), updatedAt: product.updatedAt?.toISOString() || null, qrCodeUrl: product.qrCodeUrl || null, imageUrl: product.imageUrl || null, imageFileId: product.imageFileId || null, expirationDate: product.expirationDate?.toISOString() || null, ...(stockReconcile ? { stockReconcile } : {}) });
  } catch (error) { logger.error("Error updating product:", error); return NextResponse.json({ error: "Failed to update product" }, { status: 500 }); }
}

export async function DELETE(request: NextRequest) {
  try {
    const authorization = await authorizeRequest(request, "products", "delete");
    if (authorization.response) return authorization.response;
    const session = authorization.session;
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url); const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
    const existingProduct = await prisma.product.findFirst({ where: mergeProductListWhere({ id, userId: session.id }) });
    if (!existingProduct) return NextResponse.json({ error: "Product not found, already archived, or unauthorized" }, { status: 404 });
    const orderItems = await prisma.orderItem.findMany({ where: { productId: id }, include: { order: { select: { id: true, orderNumber: true, status: true, invoice: { select: { id: true, invoiceNumber: true, status: true } } } } } });
    const strategy = getDeleteStrategy(orderItems);
    if (strategy === "block") { const activeOrders = orderItems.filter((item) => isActiveOrderStatus(item.order.status)).map((item) => item.order); const uniqueActiveOrders = Array.from(new Map(activeOrders.map((order) => [order.id, order])).values()); const ordersWithInvoices = uniqueActiveOrders.filter((order) => order.invoice); const statusCounts: Record<string, number> = {}; uniqueActiveOrders.forEach((order) => { statusCounts[order.status] = (statusCounts[order.status] || 0) + 1; }); const statusMessages = Object.entries(statusCounts).map(([status, count]) => `${count} ${status} order${count > 1 ? "s" : ""}`); return NextResponse.json({ error: `Cannot delete product \"${existingProduct.name}\" because it has ${uniqueActiveOrders.length} active order${uniqueActiveOrders.length > 1 ? "s" : ""} (${statusMessages.join(", ")}). Please wait until all active orders are delivered or cancelled before deleting this product.`, details: { activeOrdersCount: uniqueActiveOrders.length, invoicesCount: ordersWithInvoices.length, totalOrdersCount: Array.from(new Map(orderItems.map((item) => [item.order.id, item.order])).values()).length } }, { status: 409 }); }
    if (strategy === "soft") { await prisma.product.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: session.id, updatedAt: new Date(), updatedBy: session.id } }); createAuditLog({ userId: session.id, action: "delete", entityType: "product", entityId: id, details: { productName: existingProduct.name, mode: "soft" } }).catch(() => {}); await invalidateOnProductChange(); return NextResponse.json({ success: true, mode: "soft" as const }); }
    await prisma.stockAllocation.deleteMany({ where: { productId: id } }); await prisma.product.delete({ where: { id } }); const mediaSnapshot = { qrCodeFileId: existingProduct.qrCodeFileId, imageFileId: existingProduct.imageFileId }; scheduleAfterResponse(async () => { try { await cleanupProductMediaFromImageKit(mediaSnapshot); } catch (error) { if (!isImageKitNotFoundError(error)) logger.warn(`Deferred ImageKit cleanup after hard delete failed for product ${id}:`, error); } }, "product-hard-delete-imagekit"); createAuditLog({ userId: session.id, action: "delete", entityType: "product", entityId: id, details: { productName: existingProduct.name, mode: "hard" } }).catch(() => {}); await invalidateOnProductChange(); return NextResponse.json({ success: true, mode: "hard" as const });
  } catch (error) { logger.error("Error deleting product:", error); if (isPrismaRelationViolation(error)) return NextResponse.json({ error: "Product cannot be removed because it is linked to order history. Products with past orders are archived instead of permanently deleted." }, { status: 409 }); return NextResponse.json({ error: "Failed to delete product. Please try again later." }, { status: 500 }); }
}
