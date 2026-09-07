"use client";

import { useSystemConfigs } from "@/hooks/queries";
import { cn } from "@/lib/utils";

const DEFAULT_LOW_MAX = 4;
const DEFAULT_MEDIUM_MAX = 9;

function getNumericConfig(configs: Array<{ key: string; value: string }> | undefined, key: string, fallback: number) {
  const raw = configs?.find((config) => config.key === key)?.value;
  const parsed = raw == null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

export function ProductAvailableQuantity({ available }: { available: number }) {
  const { data } = useSystemConfigs();
  const lowMax = getNumericConfig(data?.configs, "low_stock_threshold", DEFAULT_LOW_MAX);
  const mediumMaxRaw = getNumericConfig(data?.configs, "medium_stock_threshold", DEFAULT_MEDIUM_MAX);
  const mediumMax = Math.max(lowMax + 1, mediumMaxRaw);

  const quantity = Math.max(0, available);
  const className =
    quantity <= 0
      ? "text-red-500"
      : quantity <= lowMax
        ? "text-orange-500"
        : quantity <= mediumMax
          ? "text-yellow-400"
          : "text-emerald-400";

  return (
    <span className={cn("text-xs font-semibold", className)}>
      {quantity} disponibles
    </span>
  );
}
