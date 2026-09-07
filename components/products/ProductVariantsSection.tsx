"use client";

import { useEffect, useState } from "react";
import { Layers, MapPin, Package } from "lucide-react";
import { GlassCard, GlassCardBody, PageContentWrapper, SectionCountBadge, SectionTitleRow } from "@/components/shared";
import { productStockAvailableTextClass } from "@/lib/ui/semantic-badges";
import { cn } from "@/lib/utils";
import type { ProductVariantView } from "@/hooks/queries/use-product-variants";

type Props = { productId: string };

export default function ProductVariantsSection({ productId }: Props) {
  const [variants, setVariants] = useState<ProductVariantView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/products/${productId}/variants`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudieron cargar las variantes");
        return response.json() as Promise<ProductVariantView[]>;
      })
      .then((data) => { if (active) setVariants(data); })
      .catch(() => { if (active) setVariants([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId]);

  if (!loading && variants.length === 0) return null;

  return (
    <PageContentWrapper>
      <div className="mx-auto w-full max-w-6xl pb-6">
        <GlassCard variant="violet">
          <GlassCardBody>
            <SectionTitleRow
              as="h3"
              icon={Layers}
              iconClassName="text-violet-600 dark:text-violet-400"
              iconTile
              title="Variantes del producto"
              trailing={!loading ? <SectionCountBadge>{variants.length} variantes</SectionCountBadge> : undefined}
              subtitle="Cada variante tiene su propio SKU, precio y stock por bodega."
            />
            {loading ? (
              <div className="mt-4 rounded-xl border border-violet-200/20 bg-white/5 p-5 text-sm text-muted-foreground">Cargando variantes…</div>
            ) : (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                {variants.map((variant) => {
                  const available = Math.max(0, variant.quantity - variant.reservedQuantity);
                  return (
                    <div key={variant.id} className="rounded-2xl border border-violet-300/20 bg-violet-500/5 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-800 dark:text-white flex items-center gap-2"><Package className="h-4 w-4 shrink-0 text-violet-400" />{variant.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">SKU: <span className="font-mono">{variant.sku}</span></p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={cn("text-sm font-semibold", productStockAvailableTextClass(available))}>{available} disponibles</p>
                          <p className="text-xs text-muted-foreground">${variant.price.toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {variant.stocks.filter((stock) => stock.quantity - stock.reservedQuantity > 0).map((stock) => (
                          <span key={stock.id} className="inline-flex items-center gap-1.5 rounded-full border border-teal-300/20 bg-teal-500/10 px-2.5 py-1 text-xs text-teal-700 dark:text-teal-200">
                            <MapPin className="h-3.5 w-3.5" />{stock.warehouseName}: {Math.max(0, stock.quantity - stock.reservedQuantity)}
                          </span>
                        ))}
                        {variant.stocks.every((stock) => stock.quantity - stock.reservedQuantity <= 0) && <span className="text-xs text-muted-foreground">Sin stock asignado a bodega</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCardBody>
        </GlassCard>
      </div>
    </PageContentWrapper>
  );
}
