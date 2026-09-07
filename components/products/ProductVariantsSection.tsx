"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, MapPin, Package } from "lucide-react";
import {
  GlassCard,
  GlassCardBody,
  PageContentWrapper,
  SectionCountBadge,
  SectionTitleRow,
} from "@/components/shared";
import { productStockAvailableTextClass } from "@/lib/ui/semantic-badges";
import { cn } from "@/lib/utils";
import type { ProductVariantView } from "@/hooks/queries/use-product-variants";

type Props = { productId: string; initialVariants?: ProductVariantView[] };

export default function ProductVariantsSection({ productId, initialVariants = [] }: Props) {
  const [variants, setVariants] = useState<ProductVariantView[]>(initialVariants);
  const [loading, setLoading] = useState(initialVariants.length === 0);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (initialVariants.length > 0) return;
    let active = true;
    fetch(`/api/products/${productId}/variants`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudieron cargar las variantes");
        return response.json() as Promise<ProductVariantView[]>;
      })
      .then((data) => { if (active) setVariants(data); })
      .catch(() => { if (active) setVariants([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId, initialVariants.length]);

  useEffect(() => {
    const header = document.querySelector("h1")?.closest<HTMLElement>(".pb-0");
    if (!header?.parentElement) return;

    const target = document.createElement("div");
    target.setAttribute("data-product-variants-slot", productId);
    header.parentElement.insertBefore(target, header.nextSibling);
    setPortalTarget(target);

    return () => {
      setPortalTarget(null);
      target.remove();
    };
  }, [productId]);

  if (!loading && variants.length === 0) return null;

  const content = (
    <PageContentWrapper>
      <div className="mx-auto w-full max-w-6xl pb-6">
        <GlassCard variant="violet">
          <GlassCardBody className="p-4 sm:p-5">
            <SectionTitleRow
              as="h3"
              icon={Layers}
              iconClassName="text-violet-600 dark:text-violet-400"
              iconTile
              title="Variantes del producto"
              trailing={!loading ? <SectionCountBadge>{variants.length} variantes</SectionCountBadge> : undefined}
              subtitle="Stock, SKU y precios por variante."
            />
            {loading ? (
              <div className="mt-4 rounded-xl border border-violet-200/20 bg-white/5 p-4 text-sm text-muted-foreground">Cargando variantes…</div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {variants.map((variant) => {
                  const available = Math.max(0, variant.quantity - variant.reservedQuantity);
                  const stockRows = variant.stocks.filter((stock) => stock.quantity - stock.reservedQuantity > 0);
                  return (
                    <div key={variant.id} className="group flex min-h-[122px] min-w-0 flex-col rounded-xl border border-violet-300/20 bg-violet-500/[0.045] p-3 transition-colors hover:border-violet-300/35 hover:bg-violet-500/[0.07]">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-gray-800 dark:text-white">
                            <Package className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                            <span className="truncate">{variant.name}</span>
                          </p>
                          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={variant.sku}>{variant.sku}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={cn("text-base font-bold leading-none", productStockAvailableTextClass(available))}>{available}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">disponibles</p>
                        </div>
                      </div>
                      <div className="mt-auto flex min-w-0 flex-wrap items-end justify-between gap-2 pt-3">
                        <div className="min-w-0 text-[10px] leading-4 text-muted-foreground">
                          <span>Costo ${variant.purchasePrice.toFixed(2)}</span><span className="mx-1">·</span><span>Venta ${variant.price.toFixed(2)}</span>
                        </div>
                        {stockRows.length > 0 ? (
                          <div className="flex min-w-0 shrink-0 flex-wrap justify-end gap-1">
                            {stockRows.map((stock) => (
                              <span key={stock.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-teal-300/20 bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-700 dark:text-teal-200" title={stock.warehouseName}>
                                <MapPin className="h-3 w-3 shrink-0" />{stock.warehouseName}: {Math.max(0, stock.quantity - stock.reservedQuantity)}
                              </span>
                            ))}
                          </div>
                        ) : <span className="shrink-0 text-[10px] text-muted-foreground">Sin bodega</span>}
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

  return portalTarget ? createPortal(content, portalTarget) : null;
}
