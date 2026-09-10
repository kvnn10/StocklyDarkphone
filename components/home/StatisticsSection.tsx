/*
 * Statistics Section — store-wide KPI cards (REQ-0021 shell-first).
 * Card titles/icons always visible; only values pulse while dashboard loads.
 */

"use client";

import React, { useMemo } from "react";
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
import { useProducts, useProductVariants, useStockAllocations, useWarehouses } from "@/hooks/queries";
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
  const productsQuery = useProducts();
  const productVariantsQuery = useProductVariants();
  const stockAllocationsQuery = useStockAllocations();
  const warehousesQuery = useWarehouses();
  const stats = dashboardQuery.data ?? initialStats ?? null;
  const dataLoading = isDataSlotUnsettled(dashboardQuery, initialStats);

  useSyncSsrQueryData(
    queryKeys.dashboard.overview(user?.id ?? ""),
    user?.id && initialStats != null ? initialStats : undefined,
  );

  const warehouseCostData = useMemo(() => {
    const products = productsQuery.data ?? [];
    const variants = productVariantsQuery.data ?? [];
    const allocations = stockAllocationsQuery.data ?? [];
    const warehouses = warehousesQuery.data ?? [];

    const purchasePriceByProduct = new Map(
      products.map((product) => [
        product.id,
        Math.max(0, Number(product.purchasePrice ?? 0)),
      ]),
    );

    const costByWarehouse = new Map<string, number>(
      warehouses.map((warehouse) => [warehouse.id, 0]),
    );

    for (const allocation of allocations) {
      const allocationCost = Math.max(
        0,
        Number(allocation.product?.purchasePrice ?? 0),
      );
      const productCost = purchasePriceByProduct.get(allocation.productId) ?? 0;
      const unitCost = allocationCost > 0 ? allocationCost : productCost;
      const quantity = Math.max(
        0,
        Number(allocation.quantity ?? 0) - Number(allocation.reservedQuantity ?? 0),
      );

      if (unitCost > 0 && quantity > 0) {
        costByWarehouse.set(
          allocation.warehouseId,
          (costByWarehouse.get(allocation.warehouseId) ?? 0) + quantity * unitCost,
        );
      }
    }

    for (const variant of variants) {
      const fallbackProductCost = purchasePriceByProduct.get(variant.productId) ?? 0;
      const variantCost = Math.max(0, Number(variant.purchasePrice ?? 0));
      const unitCost = variantCost > 0 ? variantCost : fallbackProductCost;
      if (unitCost <= 0) continue;

      for (const stock of variant.stocks ?? []) {
        const quantity = Math.max(
          0,
          Number(stock.quantity ?? 0) - Number(stock.reservedQuantity ?? 0),
        );
        if (quantity <= 0) continue;

        costByWarehouse.set(
          stock.warehouseId,
          (costByWarehouse.get(stock.warehouseId) ?? 0) + quantity * unitCost,
        );
      }
    }

    const breakdown = warehouses
      .map((warehouse) => ({
        label: warehouse.name,
        rawValue: costByWarehouse.get(warehouse.id) ?? 0,
      }))
      .sort((a, b) => b.rawValue - a.rawValue)
      .map(({ label, rawValue }) => ({
        label,
        value: formatCurrency(rawValue),
        rawValue,
      }));

    return {
      breakdown,
      total: breakdown.reduce((sum, warehouse) => sum + warehouse.rawValue, 0),
    };
  }, [productsQuery.data, productVariantsQuery.data, stockAllocationsQuery.data, warehousesQuery.data]);

  const inventorySaleValue = useMemo(() => {
    const products = productsQuery.data ?? [];
    const variants = productVariantsQuery.data ?? [];
    const variantsByProduct = new Map<string, typeof variants>();

    for (const variant of variants) {
      const list = variantsByProduct.get(variant.productId) ?? [];
      list.push(variant);
      variantsByProduct.set(variant.productId, list);
    }

    return products.reduce((sum, product) => {
      const productVariants = variantsByProduct.get(product.id) ?? [];

      if (productVariants.length > 0) {
        return (
          sum +
          productVariants.reduce((variantSum, variant) => {
            const variantSalePrice = Math.max(0, Number(variant.price ?? 0));
            if (variantSalePrice <= 0) return variantSum;

            const warehouseQuantity = (variant.stocks ?? []).reduce(
              (stockSum, stock) =>
                stockSum +
                Math.max(
                  0,
                  Number(stock.quantity ?? 0) - Number(stock.reservedQuantity ?? 0),
                ),
              0,
            );

            const fallbackQuantity = Math.max(
              0,
              Number(variant.quantity ?? 0) - Number(variant.reservedQuantity ?? 0),
            );
            const quantity = warehouseQuantity > 0 ? warehouseQuantity : fallbackQuantity;

            return variantSum + variantSalePrice * quantity;
          }, 0)
        );
      }

      const quantity = Math.max(
        0,
        Number(product.quantity ?? 0) - Number(product.reservedQuantity ?? 0),
      );
      return sum + Math.max(0, Number(product.price ?? 0)) * quantity;
    }, 0);
  }, [productsQuery.data, productVariantsQuery.data]);

  const inventoryCost = warehouseCostData.total;
  const inventoryCostLoading =
    productsQuery.isPending ||
    productVariantsQuery.isPending ||
    stockAllocationsQuery.isPending ||
    warehousesQuery.isPending;

  const inventorySaleValueLoading =
    productsQuery.isPending || productVariantsQuery.isPending;

  const warehouseCostBadges = warehouseCostData.breakdown.map(
    ({ label, value }) => ({ label, value }),
  );

  const revenueFromOrders =
    stats?.orderAnalytics?.totalRevenueExcludingCancelled ??
    stats?.revenue?.fromOrders ??
    0;
  const selfOthers = stats?.selfOthersBreakdown;
  const potentialProfit = Math.max(0, inventorySaleValue - inventoryCost);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-stretch">
      <StatisticsCard title="Total de productos" value={stats?.counts?.products ?? 0} description="Disponibilidad de productos" icon={Package} variant="rose" valueLoading={dataLoading} badgeValuesLoading={dataLoading} badges={[{ label: "Disponibles", value: stats?.productStatusBreakdown?.available ?? 0 }, { label: "Stock bajo", value: stats?.productStatusBreakdown?.stockLow ?? 0 }, { label: "Agotados", value: stats?.productStatusBreakdown?.stockOut ?? 0 }]} />
      <StatisticsCard title="Costo del inventario" value={formatCurrency(inventoryCost)} description="Valor al costo de compra" icon={DollarSign} variant="blue" valueLoading={dataLoading || inventoryCostLoading} badgeValuesLoading={inventoryCostLoading} badges={warehouseCostBadges} />
      <StatisticsCard title="Valor potencial de venta" value={formatCurrency(inventorySaleValue)} description="Al precio de venta actual" icon={DollarSign} variant="violet" valueLoading={dataLoading || inventorySaleValueLoading} />
      <StatisticsCard title="Utilidad potencial" value={formatCurrency(potentialProfit)} description="Venta potencial menos costo" icon={DollarSign} variant="emerald" valueLoading={dataLoading || inventoryCostLoading || inventorySaleValueLoading} />
      <StatisticsCard title="Ingresos totales" value={formatCurrency(revenueFromOrders)} description="Ventas netas (sin pedidos cancelados)" icon={DollarSign} variant="emerald" valueLoading={dataLoading} badgeValuesLoading={dataLoading} badges={[{ label: "Pagado", value: formatCurrency(stats?.orderAnalytics?.paidOrderAmount ?? 0) }, { label: "Parcial", value: formatCurrency(stats?.orderAnalytics?.partialOrderAmount ?? 0) }, { label: "Pendiente", value: formatCurrency(stats?.orderAnalytics?.pendingOrderAmount ?? 0) }, ...(selfOthers ? [{ label: "Propios", value: formatCurrency(selfOthers.revenueSelf) }, { label: "Otros", value: formatCurrency(selfOthers.revenueOthers) }] : [])]} />
      <StatisticsCard title="Total de pedidos" value={stats?.counts?.orders ?? 0} description="Pedidos realizados (propios y de clientes)" icon={ShoppingCart} variant="blue" valueLoading={dataLoading} badgeValuesLoading={dataLoading} badges={buildStoreOrderStatusBadges({ statusDistribution: stats?.orderAnalytics?.statusDistribution, refundedCount: stats?.orderAnalytics?.refundedCount, selfOthers: selfOthers ? { orderSelfCount: selfOthers.orderSelfCount, orderOthersCount: selfOthers.orderOthersCount } : null })} />
      <StatisticsCard title="Facturas" value={stats?.counts?.invoices ?? 0} description="Total de facturas de la tienda" icon={FileText} variant="sky" valueLoading={dataLoading} badgeValuesLoading={dataLoading} badges={buildStoreInvoiceStatusBadges({ paidCount: stats?.invoiceAnalytics?.statusDistribution?.paid, partialCount: stats?.invoiceAnalytics?.partialCount, pendingCount: stats?.invoiceAnalytics?.pendingCount ?? (stats?.invoiceAnalytics?.statusDistribution?.draft ?? 0) + (stats?.invoiceAnalytics?.statusDistribution?.sent ?? 0), overdueCount: stats?.invoiceAnalytics?.statusDistribution?.overdue, cancelledCount: stats?.invoiceAnalytics?.statusDistribution?.cancelled, refundedCount: stats?.orderAnalytics?.refundedCount, selfOthers: selfOthers ? { invoiceSelfCount: selfOthers.invoiceSelfCount, invoiceOthersCount: selfOthers.invoiceOthersCount } : null })} />
      <StatisticsCard title="Total de almacenes" value={stats?.counts?.warehouses ?? 0} description="Ubicaciones de almacenamiento" icon={Warehouse} variant="teal" valueLoading={dataLoading} badgeValuesLoading={dataLoading} badges={[{ label: "Activos", value: stats?.warehouseAnalytics?.activeWarehouses ?? 0 }, { label: "Inactivos", value: stats?.warehouseAnalytics?.inactiveWarehouses ?? 0 }]} />
    </div>
  );
}
