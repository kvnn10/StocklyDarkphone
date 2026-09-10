/**
 * Dashboard (admin overview) query hooks
 * Query key includes userId so persisted cache is per-user (avoids showing previous user's data after login switch).
 */

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { queryKeys, withInitialData } from "@/lib/react-query";
import { useAuth } from "@/contexts";
import type { DashboardStats } from "@/types";

export function useDashboard(
  initialData?: DashboardStats | null,
  options?: { enabled?: boolean },
) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const enabled = options?.enabled ?? true;

  return useQuery({
    queryKey: queryKeys.dashboard.overview(userId),
    queryFn: async () => {
      const [dashboardResponse, productsResponse, variantsResponse] = await Promise.all([
        apiClient.dashboard.getOverview(),
        apiClient.products.getAll(),
        fetch("/api/products/variants", { cache: "no-store" }),
      ]);

      const variants = variantsResponse.ok
        ? (await variantsResponse.json()) as Array<{
            productId: string;
            price: number;
            quantity: number;
            reservedQuantity: number;
            stocks?: Array<{
              quantity: number;
              reservedQuantity: number;
            }>;
          }>
        : [];

      const variantsByProduct = new Map<string, typeof variants>();
      for (const variant of variants) {
        const current = variantsByProduct.get(variant.productId) ?? [];
        current.push(variant);
        variantsByProduct.set(variant.productId, current);
      }

      // The inventory can be stored either directly on Product or separately
      // in ProductVariantStock. When a product has variant stock, use the
      // variant sale prices so the KPI values the same physical stock shown in
      // the product table instead of valuing the parent product quantity again.
      const totalAvailableInventoryValue = productsResponse.data.reduce(
        (sum, product) => {
          const productVariants = variantsByProduct.get(product.id) ?? [];
          const variantSaleValue = productVariants.reduce((variantSum, variant) => {
            const stockQuantity = (variant.stocks ?? []).reduce(
              (stockSum, stock) =>
                stockSum + Math.max(0, Number(stock.quantity ?? 0) - Number(stock.reservedQuantity ?? 0)),
              0,
            );
            const availableQuantity = stockQuantity > 0
              ? stockQuantity
              : Math.max(0, Number(variant.quantity ?? 0) - Number(variant.reservedQuantity ?? 0));
            return variantSum + Number(variant.price ?? 0) * availableQuantity;
          }, 0);

          if (variantSaleValue > 0) return sum + variantSaleValue;

          const quantity = Number(product.quantity ?? 0);
          const reservedQuantity = Number(product.reservedQuantity ?? 0);
          const availableQuantity = Math.max(0, quantity - reservedQuantity);
          return sum + Number(product.price ?? 0) * availableQuantity;
        },
        0,
      );

      return {
        ...dashboardResponse.data,
        totalInventoryValue: totalAvailableInventoryValue,
      };
    },
    enabled: !!userId && enabled,
    ...withInitialData(initialData ?? undefined),
    // KPI cards are mutable inventory data. Even when SSR provides initialData,
    // always confirm the live value against the API on mount/navigation.
    refetchOnMount: "always",
    staleTime: 0,
  });
}
