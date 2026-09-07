"use client";

import React, { useState } from "react";
import ProductList from "@/components/products/ProductList";
import { PageContentWrapper } from "@/components/shared";
import FloatingActionButtons from "@/components/shared/FloatingActionButtons";
import { useProducts } from "@/hooks/queries";
import { useAuth } from "@/contexts";
import type { ProductForHome } from "@/lib/server/home-data";
import type { DashboardStats, SupplierPortalDashboard } from "@/types";

export type AdminProductsContentProps = {
  initialProducts?: ProductForHome[];
  initialStats?: DashboardStats;
  initialSupplierPortal?: SupplierPortalDashboard | null;
};

export default function AdminProductsContent({ initialProducts, initialStats, initialSupplierPortal }: AdminProductsContentProps = {}) {
  const { data: allProducts = [], refetch } = useProducts(initialProducts);
  const { user } = useAuth();
  const [loadingLot, setLoadingLot] = useState(false);

  const loadTapasLot = async () => {
    if (loadingLot) return;
    const confirmed = window.confirm("¿Cargar el lote de 43 tapas en la bodega Darkphone?\n\nCosto: $15.000 c/u\nVenta: $50.000 c/u\nInversión: $645.000\nVenta potencial: $2.150.000\n\nLa carga se bloqueará si alguna variante ya tiene stock para evitar duplicados.");
    if (!confirmed) return;
    setLoadingLot(true);
    try {
      const response = await fetch("/api/products/bulk-tapas", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar el lote.");
      await refetch();
      window.alert(`✅ Lote cargado correctamente.\n\n${data.units} tapas en Darkphone.\nCosto: $${Number(data.totalCost).toLocaleString("es-CO")}\nVenta potencial: $${Number(data.potentialSales).toLocaleString("es-CO")}`);
    } catch (error) {
      window.alert(`❌ ${error instanceof Error ? error.message : "No se pudo cargar el lote."}`);
    } finally {
      setLoadingLot(false);
    }
  };

  return (
    <PageContentWrapper>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold">Carga rápida de inventario</h2>
          <p className="text-sm text-muted-foreground">Lote de tapas para bodega Darkphone · 43 unidades</p>
        </div>
        <button type="button" onClick={loadTapasLot} disabled={loadingLot} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
          {loadingLot ? "Cargando lote…" : "Cargar lote de tapas"}
        </button>
      </div>
      <ProductList initialProducts={initialProducts} initialStats={initialStats} initialSupplierPortal={initialSupplierPortal} />
      <FloatingActionButtons variant="products" allProducts={allProducts} userId={user?.id || ""} />
    </PageContentWrapper>
  );
}
