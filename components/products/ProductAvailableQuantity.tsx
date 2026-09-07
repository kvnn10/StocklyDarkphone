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
  const lowMax = getNumericConfig(data?.configs, "low_stock_threshold", DEFAULT_LOW_MAX);
  const mediumMax = Math.max(
    lowMax + 1,
    getNumericConfig(data?.configs, "medium_stock_threshold", DEFAULT_MEDIUM_MAX),
  );

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
      ? "text-red-400"
      : quantity <= lowMax
        ? "text-orange-400"
        : quantity <= mediumMax
          ? "text-yellow-300"
          : "text-emerald-400";

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex items-baseline gap-1 whitespace-nowrap">
        <span className={cn("text-sm font-bold leading-none tracking-tight", quantityClass)}>
          {quantity}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">disponibles</span>
      </div>
      <ProductStockStatusBadge
        status={status}
        label={statusLabel}
        size="compact"
        className="shrink-0 text-[10px] leading-none"
      />
    </div>
  );
}
