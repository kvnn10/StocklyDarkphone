import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import { getProductDetailForPage } from "@/lib/server/product-detail-data";
import { getReviewsForProductPage, getReviewEligibilityForProduct } from "@/lib/server/product-reviews-detail-data";
import { getCachedForecastingSummary } from "@/lib/server/forecasting-data";
import ProductDetailPage from "@/components/Pages/ProductDetailPage";
import ProductVariantsSection from "@/components/products/ProductVariantsSection";
import { enrichProductInsightsWithWarehouseStock } from "@/lib/insights/product-insights-enrich";
import { getStockByProductForPage } from "@/lib/server/product-stock-data";
import { prisma } from "@/prisma/client";
import type { Product } from "@/types";
import type { ProductVariantView } from "@/hooks/queries/use-product-variants";

type Props = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export default async function ProductDetailRoute({ params }: Props) {
  const user = await getSession();
  if (!user) redirect("/login");
  const { id } = await params;
  const [initialProduct, initialReviews, initialEligibility, initialStockByProduct, initialForecasting] = await Promise.all([
    getProductDetailForPage({ id: user.id, role: user.role }, id),
    getReviewsForProductPage(id, "all"),
    getReviewEligibilityForProduct(user.id, id),
    getStockByProductForPage({ id: user.id, role: user.role }, id),
    user.role === "admin" ? getCachedForecastingSummary(user.id) : Promise.resolve(null),
  ]);
  if (!initialProduct) notFound();
  const rawVariants = await prisma.productVariant.findMany({ where: { productId: id }, include: { stocks: { include: { warehouse: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "asc" } });
  const initialVariants: ProductVariantView[] = rawVariants.map((variant) => ({ id: variant.id, productId: variant.productId, name: variant.name, sku: variant.sku, price: Number(variant.price), purchasePrice: Number(variant.purchasePrice), quantity: Number(variant.quantity), reservedQuantity: Number(variant.reservedQuantity), status: variant.status, attributes: (variant.attributes && typeof variant.attributes === "object" && !Array.isArray(variant.attributes)) ? variant.attributes as Record<string, unknown> : null, stocks: variant.stocks.map((stock) => ({ id: stock.id, warehouseId: stock.warehouseId, warehouseName: stock.warehouse?.name ?? "Bodega", quantity: Number(stock.quantity), reservedQuantity: Number(stock.reservedQuantity) })) }));
  const enrichedProduct = { ...initialProduct, productInsights: initialProduct.productInsights ? enrichProductInsightsWithWarehouseStock(initialProduct.productInsights, initialStockByProduct ?? [], Number(initialProduct.quantity)) : initialProduct.productInsights };
  return <><ProductVariantsSection productId={id} initialVariants={initialVariants}/><ProductDetailPage initialProduct={enrichedProduct as unknown as Product} initialReviews={initialReviews} initialEligibility={initialEligibility} initialStockByProduct={initialStockByProduct ?? undefined} initialForecasting={initialForecasting}/></>;
}
