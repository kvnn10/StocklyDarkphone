/**
 * REQ-0084 — reusable catalog entity insights + charts (category, supplier, product detail).
 * REQ-0221 — when densify (`insights`) is mounted, parents pass dataLoading=false so
 * metrics never pulse; forecast table still uses forecastLoading.
 */

"use client";

import type { ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Clock,
  DollarSign,
  Package,
  PackageX,
  PieChart as PieChartIcon,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { ChartCard } from "@/components/ui/chart-card";
import { DeferredChartSection } from "@/components/ui/deferred-chart-section";
import { ResponsiveChartContainer } from "@/components/ui/responsive-chart-container";
import {
  CHART_LABEL_TOP_MARGIN,
  createChartBarLabelRenderer,
  formatChartCurrencyLabel,
} from "@/lib/ui/chart-point-label";
import { CATALOG_STOCK_PIE_COLORS } from "@/lib/ui/catalog-insights-chart-data";
import { DetailInfoRow } from "@/components/orders/detail";
import { GlassCard, GlassCardBody } from "@/components/shared";
import { UrgentReorderForecastTable } from "@/components/shared/catalog-detail/UrgentReorderForecastTable";
import { CatalogAllocationSummaryText } from "@/components/shared/CatalogAllocationSummaryText";
import type { CatalogEntityInsights } from "@/types/catalog-insights";
import type { CategoryForecastUrgentRow } from "@/types/category";
import type { ProductDemandForecast } from "@/types";
import { ForecastUrgencyBadge, productStockAvailableTextClass } from "@/lib/ui/semantic-badges";
import { TYPO_CARD_TITLE, TYPO_SUBTITLE } from "@/lib/ui/typography-scale";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

export type CatalogInsightsSectionProps = {
  insights: CatalogEntityInsights;
  dataLoading: boolean;
  isAdminRole: boolean;
  forecastLoading?: boolean;
  title?: string;
  subtitle?: string;
  salesChartTitle?: string;
  salesChartDescription?: string;
  stockChartTitle?: string;
  stockChartDescription?: string;
  stockChartTrailing?: ReactNode;
  salesChartData: Array<{ label: string; revenue: number; units: number }>;
  stockChartData: Array<{ name: string; value: number }>;
  stockPieColors?: string[];
  urgentReorderCount?: number;
  predictedDailyDemand?: number;
  productForecast?: ProductDemandForecast | null;
  urgentRows?: CategoryForecastUrgentRow[];
  productHref?: (productId: string) => string;
  showUrgentForecastTable?: boolean;
  stockChartCompanion?: ReactNode;
  catalogQuantity?: number;
  catalogAllocationSummary?: {
    catalogQty: number;
    allocatedTotal: number;
    unallocated: number;
    reservedCommitment?: number;
  };
  className?: string;
};

export function CatalogInsightsSection({
  insights,
  dataLoading,
  isAdminRole,
  forecastLoading = false,
  title = "Análisis",
  subtitle = "Señales derivadas de demanda e inventario",
  salesChartTitle = "Tendencia de ventas (6 meses)",
  salesChartDescription = "Ingresos de las líneas de pedido",
  stockChartTitle = "Distribución del stock",
  stockChartDescription = "Disponibles, stock bajo y agotados",
  stockChartTrailing,
  salesChartData,
  stockChartData,
  stockPieColors = CATALOG_STOCK_PIE_COLORS,
  urgentReorderCount,
  predictedDailyDemand,
  productForecast,
  urgentRows,
  productHref,
  showUrgentForecastTable = false,
  stockChartCompanion,
  catalogQuantity,
  catalogAllocationSummary,
  className,
}: CatalogInsightsSectionProps) {
  const showUrgentTable = isAdminRole && productHref && showUrgentForecastTable && (forecastLoading || (urgentRows && urgentRows.length > 0));
  const warehouseStock = insights.warehouseStock;
  const summaryParts = catalogAllocationSummary ?? (catalogQuantity != null && warehouseStock != null ? { catalogQty: catalogQuantity, allocatedTotal: warehouseStock.available + (warehouseStock.reserved ?? 0), unallocated: warehouseStock.unallocated ?? 0, reservedCommitment: warehouseStock.reserved ?? 0 } : null);
  const defaultCompanion = stockChartCompanion == null && warehouseStock != null && summaryParts != null ? (
    <GlassCard variant="teal" className="h-full flex flex-col">
      <GlassCardBody className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-teal-300/30 bg-teal-100/50 dark:border-white/15 dark:bg-white/10"><Package className="h-4 w-4 text-gray-700 dark:text-white" /></div>
          <div><h3 className={TYPO_CARD_TITLE}>Asignación del catálogo</h3><p className={TYPO_SUBTITLE}>Desglose del catálogo frente a las bodegas para este SKU</p></div>
        </div>
        <div className="mt-4 space-y-3">
          <CatalogAllocationSummaryText catalogQty={summaryParts.catalogQty} allocatedTotal={summaryParts.allocatedTotal} unallocated={summaryParts.unallocated} reservedCommitment={summaryParts.reservedCommitment} />
          <div className="space-y-2">
            <DetailInfoRow icon={Package} label="En bodegas:" tone="teal" loading={dataLoading} valueClassName={productStockAvailableTextClass(warehouseStock.available)}>{!dataLoading && warehouseStock.available}</DetailInfoRow>
            <DetailInfoRow icon={AlertCircle} label="Reservadas:" tone="amber" loading={dataLoading} valueClassName="text-amber-600 dark:text-amber-400">{!dataLoading && (warehouseStock.reserved ?? 0)}</DetailInfoRow>
            <DetailInfoRow icon={PackageX} label="Sin asignar:" tone="sky" loading={dataLoading} valueClassName="text-emerald-600 dark:text-emerald-400">{!dataLoading && (warehouseStock.unallocated ?? 0)}</DetailInfoRow>
          </div>
        </div>
      </GlassCardBody>
    </GlassCard>
  ) : stockChartCompanion;

  return (
    <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-4", className)}>
      <GlassCard padding="body" variant="emerald">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-300/30 bg-emerald-100/50 dark:border-white/15 dark:bg-white/10"><TrendingUp className="h-4 w-4 text-gray-700 dark:text-white" /></div>
          <div><h3 className={TYPO_CARD_TITLE}>{title}</h3><p className={TYPO_SUBTITLE}>{subtitle}</p></div>
        </div>
        <div className="space-y-2 mt-4">
          <DetailInfoRow icon={AlertTriangle} label="Productos con stock bajo:" tone="amber" loading={dataLoading}>{!dataLoading && insights.lowStockCount}</DetailInfoRow>
          <DetailInfoRow icon={PackageX} label="Agotados:" tone="rose" loading={dataLoading}>{!dataLoading && insights.outOfStockCount}</DetailInfoRow>
          <DetailInfoRow icon={DollarSign} label="Valor promedio del pedido:" tone="emerald" loading={dataLoading}>{!dataLoading && <span className="text-emerald-600 dark:text-emerald-400">${insights.avgOrderValue.toFixed(2)}</span>}</DetailInfoRow>
          <DetailInfoRow icon={TrendingUp} label="Velocidad de demanda (unidades/día):" tone="violet" loading={dataLoading}>{!dataLoading && insights.demandVelocity.toFixed(2)}</DetailInfoRow>
          {isAdminRole && productForecast && <>
            <DetailInfoRow icon={Clock} label="Días hasta agotarse:" tone="rose" loading={forecastLoading}>{!forecastLoading && (productForecast.daysUntilStockout ?? "∞")}</DetailInfoRow>
            <DetailInfoRow icon={Sparkles} label="Ventas diarias previstas:" tone="sky" loading={forecastLoading}>{!forecastLoading && productForecast.predictedDailySales.toFixed(1)}</DetailInfoRow>
            <DetailInfoRow icon={AlertCircle} label="Estado de reposición:" tone="amber" loading={forecastLoading}>{!forecastLoading && <ForecastUrgencyBadge urgency={productForecast.reorderRecommendation} size="detail" />}</DetailInfoRow>
          </>}
          {isAdminRole && !productForecast && <>
            <DetailInfoRow icon={AlertCircle} label="Reposición urgente:" tone="rose" loading={forecastLoading}>{!forecastLoading && urgentReorderCount}</DetailInfoRow>
            <DetailInfoRow icon={Sparkles} label="Demanda diaria prevista:" tone="sky" loading={forecastLoading}>{!forecastLoading && predictedDailyDemand?.toFixed(1)}</DetailInfoRow>
          </>}
        </div>
      </GlassCard>

      <ChartCard title={salesChartTitle} description={salesChartDescription} icon={BarChart3} variant="sky">
        <DeferredChartSection loading={dataLoading} hasData={salesChartData.length > 0}>
          <ResponsiveChartContainer>
            <BarChart data={salesChartData} margin={{ top: CHART_LABEL_TOP_MARGIN, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
              <Bar dataKey="revenue" fill="hsl(var(--chart-1))" name="Ingresos" radius={[4, 4, 0, 0]} label={createChartBarLabelRenderer(formatChartCurrencyLabel)} />
            </BarChart>
          </ResponsiveChartContainer>
        </DeferredChartSection>
      </ChartCard>

      <ChartCard title={stockChartTitle} description={stockChartDescription} icon={PieChartIcon} variant="amber" className={defaultCompanion ? undefined : "lg:col-span-2"}>
        {stockChartTrailing ? <div className="flex flex-wrap items-center gap-2 mb-3 -mt-1">{stockChartTrailing}</div> : null}
        <DeferredChartSection loading={dataLoading} hasData={stockChartData.length > 0}>
          <ResponsiveChartContainer>
            <PieChart>
              <Pie data={stockChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                {stockChartData.map((_, index) => <Cell key={`cell-${index}`} fill={stockPieColors[index % stockPieColors.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveChartContainer>
        </DeferredChartSection>
      </ChartCard>

      {defaultCompanion}

      {showUrgentTable && productHref && <UrgentReorderForecastTable rows={urgentRows} loading={forecastLoading} productHref={productHref} className="lg:col-span-2" />}
    </div>
  );
}