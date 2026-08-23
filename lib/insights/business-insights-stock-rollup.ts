import type { Product } from "@/types";
import { getDisplayCommittedQuantity } from "@/lib/products/enrich-product-committed-quantity";

export type BusinessStockRollup = {
  totalQuantity: number;
  totalReserved: number;
  totalAvailable: number;
  totalSold: number;
  totalValue: number;
};

/** Single source of truth for Business Insights stock KPIs. */
export function buildBusinessStockRollup(products: Product[]): BusinessStockRollup {
  return products.reduce<BusinessStockRollup>((acc, product) => {
    const quantity = Math.max(0, Number(product.quantity) || 0);
    const reserved = Math.min(quantity, Math.max(0, getDisplayCommittedQuantity(product)));
    const sold = Math.max(0, Number(product.statistics?.totalQuantitySold) || 0);

    acc.totalQuantity += quantity;
    acc.totalReserved += reserved;
    acc.totalAvailable += Math.max(0, quantity - reserved);
    acc.totalSold += sold;
    acc.totalValue += (Number(product.price) || 0) * quantity;
    return acc;
  }, {
    totalQuantity: 0,
    totalReserved: 0,
    totalAvailable: 0,
    totalSold: 0,
    totalValue: 0,
  });
}
