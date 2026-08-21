"use client";

/**
 * REQ-0119 — warehouse stock rollup tab on Business Insights.
 * Shell-first: titles/cards render immediately; values pulse when loading.
 */

import Link from "next/link";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DollarSign,
  Package,
  PieChart as PieChartIcon,
  Warehouse,
} from "lucide-react";
import { AnalyticsCard } from "@/components/ui/analytics-card";
import { ChartCard } from "@/components/ui/chart-card";
import { DeferredChartSection } from "@/components/ui/deferred-chart-section";
import { ResponsiveChartContainer } from "@/components/ui/responsive-chart-container";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableBodyPulseRows } from "@/components/ui/table-data-skeleton";
import { CARD_EMPTY_MESSAGE_CLASS } from "@/lib/ui/card-empty-styles";
import { TABLE_LINK_PRIMARY } from "@/lib/ui/table-typography";
import {
  buildWarehouseQuantityChartData,
  buildWarehouseRollupMetrics,
  buildWarehouseSharePieData,
} from "@/lib/insights/business-insights-warehouse-rollup";
import { SectionTitleRow } from "@/components/shared";
import { HelpTooltip } from "@/components/shared/HelpTooltip";
import { getWarehouseTypeLabel } from "@/lib/ui/warehouse-type-styles";
import {
  CHART_LABEL_TOP_MARGIN,
  createChartBarLabelRenderer,
} from "@/lib/ui/chart-point-label";
import type { WarehouseStockSummary } from "@/types/stock-allocation";

const PIE_COLORS = ["#06b6d4", "#0ea5e9", "#10b981", "#8b5cf6", "#f59e0b"];

export type BusinessInsightsWarehouseSectionProps = {
  rows: WarehouseStockSummary[];
  loading: boolean;
};

export function BusinessInsightsWarehouseSection({
  rows,
  loading,
}: BusinessInsightsWarehouseSectionProps) {
  const metrics = useMemo(() => buildWarehouseRollupMetrics(rows), [rows]);
  const quantityChartData = useMemo(
    () => buildWarehouseQuantityChartData(rows),
    [rows],
  );
  const pieData = useMemo(() => buildWarehouseSharePieData(rows), [rows]);

  return (
    <div className="flex flex-col gap-6 text-xs sm:text-sm">
      <SectionTitleRow title="Resumen de stock por almacén" icon={Warehouse} />
      <p className="text-xs text-gray-600 dark:text-white/80 -mt-4">
        Inventario asignado entre las distintas ubicaciones
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        <AnalyticsCard
          title="Ubicaciones con stock"
          value={metrics.warehousesWithStock}
          icon={Warehouse}
          variant="teal"
          description={`${metrics.warehouseCount} almacenes en total`}
          valueLoading={loading}
        />
        <AnalyticsCard
          title="Unidades asignadas"
          value={metrics.totalQuantity}
          icon={Package}
          variant="sky"
          description={`${metrics.totalSkus} filas de SKU`}
          valueLoading={loading}
        />
        <AnalyticsCard
          title="Unidades reservadas"
          value={metrics.totalReserved}
          icon={Package}
          variant="amber"
          description="Comprometidas en pedidos activos"
          valueLoading={loading}
        />
        <AnalyticsCard
          title="Valor del inventario"
          value={`$${Math.round(metrics.totalValue).toLocaleString()}`}
          icon={DollarSign}
          variant="emerald"
          description={
            metrics.topWarehouse
              ? `Principal: ${metrics.topWarehouse.name} (${metrics.concentrationPct}%)`
              : "Aún no hay asignaciones"
          }
          valueLoading={loading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <ChartCard title="Cantidad por almacén" icon={Warehouse} variant="sky">
          <DeferredChartSection
            loading={loading}
            hasData={quantityChartData.length > 0}
            pulseClassName="min-h-[300px]"
          >
            <ResponsiveChartContainer>
              <BarChart
                data={quantityChartData}
                margin={{
                  top: CHART_LABEL_TOP_MARGIN,
                  right: 8,
                  left: 0,
                  bottom: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar
                  dataKey="quantity"
                  fill="#06b6d4"
                  label={createChartBarLabelRenderer()}
                />
              </BarChart>
            </ResponsiveChartContainer>
          </DeferredChartSection>
        </ChartCard>

        <ChartCard
          title="Participación del stock por almacén"
          icon={PieChartIcon}
          variant="teal"
        >
          <DeferredChartSection
            loading={loading}
            hasData={pieData.length > 0}
            pulseClassName="min-h-[300px]"
          >
            <ResponsiveChartContainer>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent, x, y, textAnchor }) => (
                    <text
                      x={x}
                      y={y}
                      textAnchor={textAnchor}
                      dominantBaseline="central"
                      className="fill-gray-700 dark:fill-white text-xs font-normal"
                    >
                      {`${name} ${((percent || 0) * 100).toFixed(0)}%`}
                    </text>
                  )}
                  outerRadius="100%"
                  fill="#06b6d4"
                  dataKey="value"
                >
                  {pieData.map((_entry, index) => (
                    <Cell
                      key={`wh-pie-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveChartContainer>
          </DeferredChartSection>
        </ChartCard>
      </div>

      <ChartCard title="Desglose por almacén" icon={Package} variant="violet">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Almacén</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>
                <span className="inline-flex items-center gap-1">
                  Cantidad
                  <HelpTooltip
                    content="Total de unidades asignadas en este almacén"
                    side="top"
                    ariaLabel="Ayuda de la columna cantidad"
                    className="shrink-0"
                  />
                </span>
              </TableHead>
              <TableHead>
                <span className="inline-flex items-center gap-1">
                  Reservado
                  <HelpTooltip
                    content="Unidades reservadas para pedidos abiertos (ámbar/rosa cuando el nivel es elevado)"
                    side="top"
                    ariaLabel="Ayuda de la columna reservado"
                    className="shrink-0"
                  />
                </span>
              </TableHead>
              <TableHead>
                <span className="inline-flex items-center gap-1">
                  Valor
                  <HelpTooltip
                    content="Valor estimado del inventario a partir del stock asignado"
                    side="top"
                    ariaLabel="Ayuda de la columna valor"
                    className="shrink-0"
                  />
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {loading && rows.length === 0 ? (
            <TableBodyPulseRows columnCount={5} rows={4} />
          ) : (
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className={CARD_EMPTY_MESSAGE_CLASS}>
                    Aún no hay asignaciones de almacén. Asigna stock desde la página de detalle del almacén.
                  </TableCell>
                </TableRow>
              ) : (
                [...rows]
                  .sort((a, b) => b.totalQuantity - a.totalQuantity)
                  .map((row) => {
                    const typeLabel = getWarehouseTypeLabel(row.warehouseType);
                    const hasReserved = row.totalReserved > 0;
                    const reservedClass = hasReserved
                      ? row.totalReserved > row.totalQuantity * 0.5
                        ? "text-rose-600 dark:text-rose-400 font-medium"
                        : "text-amber-600 dark:text-amber-400 font-medium"
                      : "text-gray-400 dark:text-gray-500";
                    return (
                      <TableRow key={row.warehouseId}>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Link
                              href={`/warehouses/${row.warehouseId}`}
                              className={TABLE_LINK_PRIMARY}
                            >
                              {row.warehouseName}
                            </Link>
                            {typeLabel && typeLabel !== "—" ? (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {typeLabel}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{row.totalProducts}</TableCell>
                        <TableCell className="text-sky-600 dark:text-sky-400 font-medium">
                          {row.totalQuantity}
                        </TableCell>
                        <TableCell className={reservedClass}>
                          {row.totalReserved}
                        </TableCell>
                        <TableCell className="text-emerald-600 dark:text-emerald-400 font-medium">
                          ${Math.round(row.totalValue).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    );
                  })
              )}
            </TableBody>
          )}
        </Table>
      </ChartCard>
    </div>
  );
}
