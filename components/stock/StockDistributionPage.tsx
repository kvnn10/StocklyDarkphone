"use client";

import React, { useMemo, useState } from "react";
import { ArrowRightLeft, Boxes, Check, ChevronDown, Package, Warehouse as WarehouseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import Navbar from "@/components/layouts/Navbar";
import { PageContentWrapper, PageSectionHeader, GlassCard, GlassCardBody, SectionCountBadge } from "@/components/shared";
import { useProducts, useStockByProduct } from "@/hooks/queries";
import { useProductStore } from "@/stores";
import type { Product, StockAllocation } from "@/types";
import { WarehouseTypeBadge } from "@/lib/ui/semantic-badges";
import TransferStockDialog from "@/components/warehouses/TransferStockDialog";
import { cn } from "@/lib/utils";

function ProductPicker({ products, selected, onSelect }: { products: Product[]; selected: Product | null; onSelect: (product: Product) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" role="combobox" className="h-auto min-h-12 w-full justify-between rounded-xl border border-violet-300/30 bg-white/40 px-3 py-2 text-left dark:border-violet-400/15 dark:bg-white/5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/10">
              {selected?.imageUrl ? <img src={selected.imageUrl} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-white/60" />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-gray-800 dark:text-white">{selected?.name ?? "Selecciona un producto"}</p>
              <p className="truncate text-xs text-gray-500 dark:text-white/50">{selected?.sku ?? "Busca por nombre o SKU"}</p>
            </div>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-white/50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,620px)] p-0">
        <Command>
          <CommandInput placeholder="Buscar producto por nombre o SKU…" />
          <CommandList className="max-h-[min(60vh,420px)]">
            <CommandEmpty>No encontramos productos.</CommandEmpty>
            <CommandGroup>
              {products.map((product) => (
                <CommandItem
                  key={product.id}
                  value={`${product.name} ${product.sku ?? ""}`}
                  onSelect={() => { onSelect(product); setOpen(false); }}
                  className="py-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-white/10">
                      {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" /> : <Package className="m-2 h-5 w-5 text-white/50" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm">{product.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{product.sku}</p>
                    </div>
                  </div>
                  <Check className={cn("ml-2 h-4 w-4", selected?.id === product.id ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function StockDistributionPage() {
  const { data: products = [], isLoading: productsLoading } = useProducts();
  const [selectedProductId, setSelectedProductId] = useState("");
  const [transferSource, setTransferSource] = useState<StockAllocation | null>(null);
  const selectedProduct = useMemo(() => products.find((product) => product.id === selectedProductId) ?? null, [products, selectedProductId]);
  const { data: allocations = [], isLoading: stockLoading } = useStockByProduct(selectedProductId, undefined, { enabled: Boolean(selectedProductId) });

  const catalogQuantity = Number(selectedProduct?.quantity ?? 0);
  const allocatedQuantity = allocations.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
  const reservedQuantity = allocations.reduce((sum, row) => sum + Number(row.reservedQuantity ?? 0), 0);
  const availableQuantity = allocations.reduce((sum, row) => sum + Math.max(0, Number(row.quantity ?? 0) - Number(row.reservedQuantity ?? 0)), 0);
  const unallocatedQuantity = Math.max(0, catalogQuantity - allocatedQuantity);
  const hasWarehouseStock = allocations.length > 0;

  return (
    <Navbar>
      <PageContentWrapper>
        <div className="mx-auto w-full max-w-6xl space-y-4 poppins">
          <PageSectionHeader
            as="h1"
            tone="violet"
            icon={Boxes}
            title="Distribución de inventario"
            description="Visualiza cuánto stock de cada producto está en cada bodega y muévelo sin perder el control del inventario."
          />

          <GlassCard variant="violet">
            <GlassCardBody>
              <div className="mb-2 flex items-center gap-2">
                <Package className="h-4 w-4 text-violet-400" />
                <h2 className="text-sm font-medium text-gray-800 dark:text-white">Producto</h2>
              </div>
              <ProductPicker products={products} selected={selectedProduct} onSelect={(product) => setSelectedProductId(product.id)} />
              {productsLoading ? <p className="mt-2 text-xs text-white/50">Cargando productos…</p> : null}
            </GlassCardBody>
          </GlassCard>

          {!selectedProduct ? (
            <GlassCard variant="sky">
              <GlassCardBody className="py-12 text-center">
                <Boxes className="mx-auto mb-3 h-10 w-10 text-sky-400/60" />
                <p className="text-sm text-gray-700 dark:text-white">Selecciona un producto para ver su distribución.</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-white/50">Aquí podrás detectar rápidamente stock sin asignar y mover unidades entre bodegas.</p>
              </GlassCardBody>
            </GlassCard>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                {[
                  ["Catálogo", catalogQuantity, "sky"],
                  ["Asignado", allocatedQuantity, "violet"],
                  ["Disponible", availableQuantity, "emerald"],
                  ["Reservado", reservedQuantity, "amber"],
                  ["Sin asignar", unallocatedQuantity, "rose"],
                ].map(([label, value, tone]) => (
                  <GlassCard key={String(label)} variant={tone as "sky" | "violet" | "emerald" | "amber" | "rose"}>
                    <GlassCardBody className="py-3 text-center">
                      <p className="text-lg font-semibold text-gray-800 dark:text-white">{value}</p>
                      <p className="text-[11px] text-gray-500 dark:text-white/50">{label}</p>
                    </GlassCardBody>
                  </GlassCard>
                ))}
              </div>

              <GlassCard variant="teal">
                <GlassCardBody>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-white"><WarehouseIcon className="h-4 w-4 text-teal-400" /> Stock por bodega</h2>
                      <p className="mt-1 text-xs text-gray-500 dark:text-white/50">Cada fila representa una asignación independiente del mismo producto.</p>
                    </div>
                    <SectionCountBadge>{allocations.length} {allocations.length === 1 ? "bodega" : "bodegas"}</SectionCountBadge>
                  </div>

                  {stockLoading ? (
                    <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-white/10" />)}</div>
                  ) : hasWarehouseStock ? (
                    <div className="space-y-2">
                      {allocations.map((allocation) => {
                        const total = Number(allocation.quantity ?? 0);
                        const reserved = Number(allocation.reservedQuantity ?? 0);
                        const available = Math.max(0, total - reserved);
                        const warehouse = allocation.warehouse;
                        const percent = allocatedQuantity > 0 ? Math.round((total / allocatedQuantity) * 100) : 0;
                        return (
                          <div key={allocation.id} className="rounded-xl border border-teal-200/20 bg-white/30 p-3 dark:border-teal-400/10 dark:bg-white/5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-teal-300/20 bg-teal-500/10"><WarehouseIcon className="h-5 w-5 text-teal-400" /></div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="truncate text-sm font-medium text-gray-800 dark:text-white">{warehouse?.name ?? "Bodega"}</p>
                                    {warehouse?.type ? <WarehouseTypeBadge type={warehouse.type} size="compact" /> : null}
                                  </div>
                                  <p className="mt-0.5 text-xs text-gray-500 dark:text-white/50">{percent}% del stock asignado · {available} disponibles{reserved > 0 ? ` · ${reserved} reservadas` : ""}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 sm:shrink-0">
                                <div className="text-right">
                                  <p className="text-lg font-semibold text-gray-800 dark:text-white">{total}</p>
                                  <p className="text-[11px] text-gray-500 dark:text-white/50">unidades</p>
                                </div>
                                <Button type="button" onClick={() => setTransferSource(allocation)} disabled={available <= 0} className="gap-2 rounded-xl bg-teal-600/80 hover:bg-teal-600">
                                  <ArrowRightLeft className="h-4 w-4" />
                                  <span className="hidden sm:inline">Mover</span>
                                </Button>
                              </div>
                            </div>
                            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-teal-400/80" style={{ width: `${Math.min(100, percent)}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-teal-200/20 py-10 text-center">
                      <WarehouseIcon className="mx-auto mb-2 h-8 w-8 text-teal-400/50" />
                      <p className="text-sm text-gray-700 dark:text-white">Este producto todavía no está asignado a ninguna bodega.</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-white/50">Asigna stock desde el detalle de una bodega para empezar a distribuirlo.</p>
                    </div>
                  )}
                </GlassCardBody>
              </GlassCard>

              {unallocatedQuantity > 0 ? (
                <GlassCard variant="amber">
                  <GlassCardBody className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div><p className="text-sm font-medium text-gray-800 dark:text-white">Hay {unallocatedQuantity} unidades sin bodega</p><p className="text-xs text-gray-500 dark:text-white/50">El stock de catálogo supera la suma de las asignaciones actuales.</p></div>
                    <Button asChild variant="outline" className="rounded-xl"><a href="/warehouses">Ir a bodegas</a></Button>
                  </GlassCardBody>
                </GlassCard>
              ) : null}
            </>
          )}
        </div>
        {transferSource ? (
          <TransferStockDialog
            open={Boolean(transferSource)}
            onOpenChange={(open) => { if (!open) setTransferSource(null); }}
            fromWarehouseId={transferSource.warehouseId}
            fromWarehouseName={transferSource.warehouse?.name}
            stockAllocations={allocations}
          />
        ) : null}
      </PageContentWrapper>
    </Navbar>
  );
}
