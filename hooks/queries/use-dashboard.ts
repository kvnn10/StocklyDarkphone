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
      const [dashboardResponse, productsResponse] = await Promise.all([
        apiClient.dashboard.getOverview(),
        apiClient.products.getAll(),
      ]);

      // The product list shows AVAILABLE stock (quantity - reservedQuantity),
      // while the server dashboard KPI previously valued gross quantity.
      // Keep the dashboard Total Value consistent with the inventory screen.
      const totalAvailableInventoryValue = productsResponse.data.reduce(
        (sum, product) => {
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
