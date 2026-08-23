/**
 * Statistics Section — store-wide KPI cards (REQ-0021 shell-first).
 * Card titles/icons always visible; only values pulse while dashboard loads.
 */

"use client";

import React from "react";
import {
  Package,
  FolderTree,
  Truck,
  DollarSign,
  ShoppingCart,
  FileText,
  Warehouse,
} from "lucide-react";
import { StatisticsCard } from "./StatisticsCard";
import { useDashboard } from "@/hooks/queries/use-dashboard";
import {
  isDataSlotUnsettled,
  queryKeys,
  useSyncSsrQueryData,
} from "@/lib/react-query";
import { buildStoreOrderStatusBadges } from "@/lib/ui/store-order-status-badges";
import { buildStoreInvoiceStatusBadges } from "@/lib/ui/store-invoice-status-badges";
import { useAuth } from "@/contexts";
import type { DashboardStats } from "@/types";

const formatCurrency = (value: number) =>
  `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export type StatisticsSectionProps = {
  /** SSR-passed dashboard stats for first-render hydration */
  initialStats?: DashboardStats | null;
};

export function StatisticsSection({
  initialStats,
}: StatisticsSectionProps = {}) {
  const { user } = useAuth();
  const dashboardQuery = useDashboard(initialStats ?? undefined);
  const stats = dashboardQuery.data ?? initialStats ?? null;
  const dataLoading = isDataSlotUnsettled(dashboardQuery, initialStats);

  useSyncSsrQueryData(
    queryKeys.dashboard.overview(user?.id ?? ""),
    user?.id && initialStats != null ? initialStats : undefined,
  );

  const revenueFromOrders =
    stats?.orderAnalytics?.totalRevenueExcludingCancelled ??
    stats?.revenue?.fromOrders ??
    0;
  const selfOthers = stats?.selfOthersBreakdown;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-stretch">
      <StatisticsCard
        title="T​otal de productos"
        value={stats?.counts?.products ?? 0}
        description="Disponibilidad de productos"
        icon={Package}
        variant="rose"
        valueLoading={dataLoading}
        badgeValuesLoading={dataLoading}
        badges={[
          { label: "Disponibles", value: stats?.productStatusBreakdown?.available ?? 0 },
          { label: "Stock bajo", value: stats?.productStatusBreakdown?.stockLow ?? 0 },
          { label: "Agotados", value: stats?.productStatusBreakdown?.stockOut ?? 0 },
        ]}
      />
      <StatisticsCard
        title="Valor total"
        value={formatCurrency(stats?.totalInventoryValue ?? 0)}
        description="Valor total del inventario"
        icon={DollarSign}
        variant="violet"
        valueLoading={dataLoading}
      />
      <StatisticsCard
        title="Ingresos totales"
        value={formatCurrency(revenueFromOrders)}
        description="Ventas netas (sin pedidos cancelados)"
        icon={DollarSign}
        variant="emerald"
        valueLoading={dataLoading}
        badgeValuesLoading={dataLoading}
        badges={[
          { label: "Pagado", value: formatCurrency(stats?.orderAnalytics?.paidOrderAmount ?? 0) },
          { label: "Parcial", value: formatCurrency(stats?.orderAnalytics?.partialOrderAmount ?? 0) },
          { label: "Pendiente", value: formatCurrency(stats?.orderAnalytics?.pendingOrderAmount ?? 0) },
          ...(selfOthers
            ? [
                { label: "Propios", value: formatCurrency(selfOthers.revenueSelf) },
                { label: "Otros", value: formatCurrency(selfOthers.revenueOthers) },
              ]
            : []),
        ]}
      />
      <StatisticsCard
        title="T​otal de pedidos"
        value={stats?.counts?.orders ?? 0}
        description="Pedidos realizados (propios y de clientes)"
        icon={ShoppingCart}
        variant="blue"
        valueLoading={dataLoading}
        badgeValuesLoading={dataLoading}
        badges={buildStoreOrderStatusBadges({
          statusDistribution: stats?.orderAnalytics?.statusDistribution,
          refundedCount: stats?.orderAnalytics?.refundedCount,
          selfOthers: selfOthers
            ? { orderSelfCount: selfOthers.orderSelfCount, orderOthersCount: selfOthers.orderOthersCount }
            : null,
        })}
      />
      <StatisticsCard
        title="Facturas"
        value={stats?.counts?.invoices ?? 0}
        description="T​otal de facturas de la tienda"
        icon={FileText}
        variant="sky"
        valueLoading={dataLoading}
        badgeValuesLoading={dataLoading}
        badges={buildStoreInvoiceStatusBadges({
          paidCount: stats?.invoiceAnalytics?.statusDistribution?.paid,
          partialCount: stats?.invoiceAnalytics?.partialCount,
          pendingCount: stats?.invoiceAnalytics?.pendingCount ?? (stats?.invoiceAnalytics?.statusDistribution?.draft ?? 0) + (stats?.invoiceAnalytics?.statusDistribution?.sent ?? 0),
          overdueCount: stats?.invoiceAnalytics?.statusDistribution?.overdue,
          cancelledCount: stats?.invoiceAnalytics?.statusDistribution?.cancelled,
          refundedCount: stats?.orderAnalytics?.refundedCount,
          selfOthers: selfOthers
            ? { invoiceSelfCount: selfOthers.invoiceSelfCount, invoiceOthersCount: selfOthers.invoiceOthersCount }
            : null,
        })}
      />
      <StatisticsCard
        title="T​otal de almacenes"
        value={stats?.counts?.warehouses ?? 0}
        description="Ubicaciones de almacenamiento"
        icon={Warehouse}
        variant="teal"
        valueLoading={dataLoading}
        badgeValuesLoading={dataLoading}
        badges={[
          { label: "Activos", value: stats?.warehouseAnalytics?.activeWarehouses ?? 0 },
          { label: "Inactivos", value: stats?.warehouseAnalytics?.inactiveWarehouses ?? 0 },
        ]}
      />
      <StatisticsCard
        title="T​otal de proveedores"
        value={stats?.counts?.suppliers ?? 0}
        description="Proveedores registrados"
        icon={Truck}
        variant="emerald"
        valueLoading={dataLoading}
        badgeValuesLoading={dataLoading}
        badges={[
          { label: "Activos", value: stats?.supplierStatusBreakdown?.active ?? 0 },
          { label: "Inactivos", value: stats?.supplierStatusBreakdown?.inactive ?? 0 },
        ]}
      />
      <StatisticsCard
        title="Categorías"
        value={stats?.counts?.categories ?? 0}
        description="Categorías de productos"
        icon={FolderTree}
        variant="amber"
        valueLoading={dataLoading}
        badgeValuesLoading={dataLoading}
        badges={[
          { label: "Activas", value: stats?.categoryStatusBreakdown?.active ?? 0 },
          { label: "Inactivas", value: stats?.categoryStatusBreakdown?.inactive ?? 0 },
        ]}
      />
    </div>
  );
}
