"use client";

import { useSystemConfigs } from "@/hooks/queries";
import { ProductStockStatusBadge } from "@/lib/ui/semantic-badges";
import { cn } from "@/lib/utils";

const DEFAULT_LOW_MAX = 4;
const DEFAULT_MEDIUM_MAX = 9;

function getNumericConfig(
  configs: Array<{ key: string; value: string }> | undefined,
  key: string,
  fallback: number,
) {
  const raw = configs?.find((config) => config.key === key)?.value;
  const parsed = raw == null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

export function ProductAvailableQuantity({ available }: { available: number }) {
  const { data } = useSystemConfigs();
  const lowMax = getNumericConfig(
    data?.configs,
    "low_stock_threshold",
    DEFAULT_LOW_MAX,
  );
  const mediumMaxRaw = getNumericConfig(
    data?.configs,
    "medium_stock_threshold",
    DEFAULT_MEDIUM_MAX,
  );
  const mediumMax = Math.max(lowMax + 1, mediumMaxRaw);

  const quantity = Math.max(0, available);
  const status =
    quantity <= 0
      ? "stock_out"
      : quantity <= lowMax
        ? "stock_low"
        : quantity <= mediumMax
          ? "in_stock"
          : "available";
  const statusLabel =
    quantity <= 0
      ? "Sin stock"
      : quantity <= lowMax
        ? "Stock bajo"
        : quantity <= mediumMax
          ? "Stock medio"
          : "Stock disponible";
  const quantityClass =
    quantity <= 0
      ? "text-red-500"
      : quantity <= lowMax
        ? "text-orange-500"
        : quantity <= mediumMax
          ? "text-yellow-400"
          : "text-emerald-400";

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span className={cn("text-xs font-semibold", quantityClass)}>
        {quantity} disponibles
      </span>
      <ProductStockStatusBadge
        status={status}
        label={statusLabel}
        size="compact"
        className="text-[10px]"
      />
    </div>
  );
}
