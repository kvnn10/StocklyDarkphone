"use client";

import React, { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { PaginationType } from "@/components/shared/PaginationSelector";
import { createProductColumns } from "./ProductTableColumns";
import { useAuth } from "@/contexts";
import { useProducts, useCategories, useSuppliers, useOrders, useDashboard, useSupplierPortalDashboard, useProductVariants, useStockAllocations, useWarehouses } from "@/hooks/queries";
import { isDataSlotLoading, isDataSlotUnsettled, queryKeys, useSyncSsrQueryData } from "@/lib/react-query";
import ProductFilters from "./ProductFilters";
import { StatisticsCard } from "@/components/home/StatisticsCard";
import { Package, DollarSign, Truck, FolderTree } from "lucide-react";
import { PageSectionHeader } from "@/components/shared";
import type { Product } from "@/types";
import type { ProductForHome } from "@/lib/server/home-data";
import type { DashboardStats, SupplierPortalDashboard } from "@/types";
import { APP_SHELL_WIDTH_CLASS } from "@/lib/ui/shell-layout-styles";

const ProductTable = dynamic(() => import("./ProductTable").then((mod) => ({ default: mod.ProductTable })), { ssr: true });

export type ProductListProps = { initialProducts?: Product[] | ProductForHome[]; initialStats?: DashboardStats; initialSupplierPortal?: SupplierPortalDashboard | null };

const ProductList = React.memo(function ProductList({ initialProducts, initialStats, initialSupplierPortal }: ProductListProps = {}) {
  const pathname = usePathname();
  const { user } = useAuth();
  const isAdminProducts = pathname?.startsWith("/admin") ?? false;
  const isUserProductsPage = pathname === "/products" && user?.role !== "client" && user?.role !== "supplier";
  const isAdminProductsPage = pathname === "/admin/products";
  const isSupplierProductsPage = pathname === "/products" && user?.role === "supplier";
  const enableDashboard = isUserProductsPage || isAdminProductsPage;

  const productsQuery = useProducts(initialProducts);
  const categoriesQuery = useCategories();
  const suppliersQuery = useSuppliers();
  const ordersQuery = useOrders();
  const variantsQuery = useProductVariants();
  const stockAllocationsQuery = useStockAllocations();
  const warehousesQuery = useWarehouses();
  const dashboardQuery = useDashboard(initialStats, { enabled: enableDashboard });
  const supplierPortalQuery = useSupplierPortalDashboard(isSupplierProductsPage ? (initialSupplierPortal ?? undefined) : undefined);

  useSyncSsrQueryData(queryKeys.products.lists(), initialProducts);
  useSyncSsrQueryData(queryKeys.dashboard.overview(user?.id ?? ""), enableDashboard && user?.id && initialStats !== undefined ? initialStats : undefined);
  useSyncSsrQueryData(queryKeys.portal.supplierDashboard(user?.id ?? ""), isSupplierProductsPage && user?.id ? (initialSupplierPortal ?? undefined) : undefined);

  const allProducts = productsQuery.data ?? [];
  const allCategories = categoriesQuery.data ?? [];
  const allSuppliers = suppliersQuery.data ?? [];
  const allOrders = ordersQuery.data ?? [];
  const allVariants = variantsQuery.data ?? [];
  const allStockAllocations = stockAllocationsQuery.data ?? [];
  const allWarehouses = warehousesQuery.data ?? [];
  const variantsByProductId = useMemo(() => allVariants.reduce<Record<string, typeof allVariants>>((map, variant) => { (map[variant.productId] ??= []).push(variant); return map; }, {}), [allVariants]);
  const dashboard = isAdminProducts ? (dashboardQuery.data ?? null) : null;
  const productsPageStats = isUserProductsPage ? (dashboardQuery.data ?? null) : null;

  const detailBase = isAdminProducts ? "/admin" : "";
  const columns = useMemo(() => createProductColumns(detailBase, { forSupplier: isSupplierProductsPage, variantsByProductId }), [detailBase, isSupplierProductsPage, variantsByProductId]);

  const tableDataLoading = isDataSlotLoading(productsQuery, initialProducts);
  const dashboardCardsLoading = enableDashboard ? isDataSlotUnsettled(dashboardQuery, initialStats) : false;
  const supplierCardsLoading = isSupplierProductsPage ? isDataSlotUnsettled(supplierPortalQuery, initialSupplierPortal ?? undefined) : false;
  const supplierPortal = supplierPortalQuery.data;
  const [searchTerm, setSearchTerm] = useState("");
  const [pagination, setPagination] = useState<PaginationType>({ pageIndex: 0, pageSize: 8 });
  const [selectedCategory, setSelectedCategory] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);

  const formatCurrency = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const nonCancelledSupplierOrders = Math.max(0, (supplierPortal?.totalOrders ?? 0) - (supplierPortal?.orderStatusCounts?.cancelled ?? 0));
  const supplierAvgOrder = nonCancelledSupplierOrders > 0 ? (supplierPortal?.totalRevenue ?? 0) / nonCancelledSupplierOrders : 0;

  const warehouseInventoryStats = useMemo(() => {
    const productById = new Map(allProducts.map((product) => [product.id, product]));
    const variantProductIds = new Set(allVariants.map((variant) => variant.productId));
    const costByWarehouse = new Map<string, number>(allWarehouses.map((warehouse) => [warehouse.id, 0]));
    const saleByWarehouse = new Map<string, number>(allWarehouses.map((warehouse) => [warehouse.id, 0]));

    // Products with variants get their stock from variant.stocks. This avoids
    // counting a product-level allocation twice when the variants own the inventory.
    for (const allocation of allStockAllocations) {
      if (variantProductIds.has(allocation.productId)) continue;

      const product = productById.get(allocation.productId);
      const quantity = Math.max(0, Number(allocation.quantity ?? 0) - Number(allocation.reservedQuantity ?? 0));
      if (quantity <= 0) continue;

      const purchasePrice = Math.max(0, Number(allocation.product?.purchasePrice ?? product?.purchasePrice ?? 0));
      const salePrice = Math.max(0, Number(product?.price ?? 0));

      if (purchasePrice > 0) {
        costByWarehouse.set(allocation.warehouseId, (costByWarehouse.get(allocation.warehouseId) ?? 0) + quantity * purchasePrice);
      }
      if (salePrice > 0) {
        saleByWarehouse.set(allocation.warehouseId, (saleByWarehouse.get(allocation.warehouseId) ?? 0) + quantity * salePrice);
      }
    }

    for (const variant of allVariants) {
      const product = productById.get(variant.productId);
      const quantityByWarehouse = variant.stocks ?? [];
      const purchasePrice = Math.max(0, Number(variant.purchasePrice ?? product?.purchasePrice ?? 0));
      const salePrice = Math.max(0, Number(variant.price ?? product?.price ?? 0));

      for (const stock of quantityByWarehouse) {
        const quantity = Math.max(0, Number(stock.quantity ?? 0) - Number(stock.reservedQuantity ?? 0));
        if (quantity <= 0) continue;

        if (purchasePrice > 0) {
          costByWarehouse.set(stock.warehouseId, (costByWarehouse.get(stock.warehouseId) ?? 0) + quantity * purchasePrice);
        }
        if (salePrice > 0) {
          saleByWarehouse.set(stock.warehouseId, (saleByWarehouse.get(stock.warehouseId) ?? 0) + quantity * salePrice);
        }
      }
    }

    const costBreakdown = allWarehouses
      .map((warehouse) => ({ label: warehouse.name, value: costByWarehouse.get(warehouse.id) ?? 0 }))
      .sort((a, b) => b.value - a.value);
    const saleBreakdown = allWarehouses
      .map((warehouse) => ({ label: warehouse.name, value: saleByWarehouse.get(warehouse.id) ?? 0 }))
      .sort((a, b) => b.value - a.value);

    return {
      costTotal: costBreakdown.reduce((sum, item) => sum + item.value, 0),
      saleTotal: saleBreakdown.reduce((sum, item) => sum + item.value, 0),
      costBreakdown,
      saleBreakdown,
    };
  }, [allProducts, allVariants, allStockAllocations, allWarehouses]);

  const warehouseCardsLoading = productsQuery.isPending || variantsQuery.isPending || stockAllocationsQuery.isPending || warehousesQuery.isPending;
  const warehouseSaleBadges = warehouseInventoryStats.saleBreakdown.map(({ label, value }) => ({ label, value: formatCurrency(value) }));
  const warehouseCostBadges = warehouseInventoryStats.costBreakdown.map(({ label, value }) => ({ label, value: formatCurrency(value) }));

  const productStats = useMemo(() => { const total = allProducts.length; const available = allProducts.filter((p) => (p.status || "").toLowerCase().replace(/\s+/g, "_") === "available").length; const stockLow = allProducts.filter((p) => (p.status || "").toLowerCase().replace(/\s+/g, "_") === "stock_low").length; const stockOut = allProducts.filter((p) => (p.status || "").toLowerCase().replace(/\s+/g, "_") === "stock_out").length; const totalValue = allProducts.reduce((sum, p) => sum + (Number(p.price) || 0) * (Number(p.quantity) || 0), 0); return { total, available, stockLow, stockOut, totalValue }; }, [allProducts]);
  const orderStats = useMemo(() => { const total = allOrders.length; const paidOrders = allOrders.filter((o) => (o.paymentStatus || "").toLowerCase() === "paid"); const paid = paidOrders.length; const unpaid = allOrders.filter((o) => (o.paymentStatus || "").toLowerCase() === "unpaid" || (o.paymentStatus || "").toLowerCase() === "partial").length; const totalRevenue = paidOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0); const pending = allOrders.filter((o) => (o.status || "").toLowerCase() === "pending").length; const confirmed = allOrders.filter((o) => (o.status || "").toLowerCase() === "confirmed").length; const shipping = allOrders.filter((o) => (o.status || "").toLowerCase() === "shipped" || (o.status || "").toLowerCase() === "processing").length; const refunded = allOrders.filter((o) => (o.paymentStatus || "").toLowerCase() === "refunded").length; const cancelled = allOrders.filter((o) => (o.status || "").toLowerCase() === "cancelled").length; return { total, paid, unpaid, totalRevenue, pending, confirmed, shipping, refunded, cancelled }; }, [allOrders]);
  const cardVariantClasses = { violet: "border-violet-400/30 bg-gradient-to-br from-violet-500/25 via-violet-500/10 to-violet-500/5 shadow-[0_20px_50px_rgba(139,92,246,0.25)] dark:shadow-[0_20px_50px_rgba(139,92,246,0.15)]", emerald: "border-emerald-400/30 bg-gradient-to-br from-emerald-500/25 via-emerald-500/10 to-emerald-500/5 shadow-[0_20px_50px_rgba(16,185,129,0.25)] dark:shadow-[0_20px_50px_rgba(16,185,129,0.15)]", amber: "border-amber-400/30 bg-gradient-to-br from-amber-500/30 via-amber-500/15 to-amber-500/5 shadow-[0_20px_50px_rgba(245,158,11,0.2)] dark:shadow-[0_20px_50px_rgba(245,158,11,0.12)]", blue: "border-blue-400/30 bg-gradient-to-br from-blue-500/25 via-blue-500/10 to-blue-500/5 shadow-[0_20px_50px_rgba(59,130,246,0.25)] dark:shadow-[0_20px_50px_rgba(59,130,246,0.15)]" };

  return <div className="flex flex-col poppins">
    <PageSectionHeader as="h2" icon={Package} tone="rose" title={isSupplierProductsPage ? "My Products" : "Product Inventory Management"} description={isSupplierProductsPage ? "Products supplied by you. View stock, categories, and which store owner manages each product. Use filters and search to find items quickly." : "Efficiently manage your product catalog with advanced filtering, search capabilities, and real-time stock tracking. Monitor inventory levels, organize by categories and suppliers, and maintain optimal stock control."} />

    {isSupplierProductsPage && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-stretch pb-6">
      <StatisticsCard title="Total Products" value={supplierPortal?.totalProducts ?? 0} description="Products in your catalog" icon={Package} variant="rose" valueLoading={supplierCardsLoading} badgeValuesLoading={supplierCardsLoading} badges={[{ label: "Available", value: supplierPortal?.productStatusCounts?.available ?? 0 }, { label: "Stock low", value: supplierPortal?.productStatusCounts?.stockLow ?? 0 }, { label: "Stock out", value: supplierPortal?.productStatusCounts?.stockOut ?? 0 }]} />
      <StatisticsCard title="Product Value" value={formatCurrency(supplierPortal?.productValue ?? 0)} description="Total Product value assigned by owner" icon={DollarSign} variant="violet" valueLoading={supplierCardsLoading} badgeValuesLoading={supplierCardsLoading} badges={[{ label: "Orders", value: formatCurrency(supplierPortal?.valueBreakdown?.orders ?? 0) }, { label: "Invoices", value: formatCurrency(supplierPortal?.valueBreakdown?.invoices ?? 0) }, { label: "Due", value: formatCurrency(supplierPortal?.valueBreakdown?.due ?? 0) }, { label: "Cancelled", value: formatCurrency(supplierPortal?.valueBreakdown?.cancelled ?? 0) }, { label: "Refunded", value: formatCurrency(supplierPortal?.valueBreakdown?.refunded ?? 0) }]} />
      <StatisticsCard title="Total Orders" value={supplierPortal?.totalOrders ?? 0} description="Orders containing your products" icon={Truck} variant="emerald" valueLoading={supplierCardsLoading} badgeValuesLoading={supplierCardsLoading} badges={[{ label: "Pending", value: supplierPortal?.orderStatusCounts?.pending ?? 0 }, { label: "In progress", value: supplierPortal?.orderStatusCounts?.inProgress ?? 0 }, { label: "Shipping", value: supplierPortal?.orderStatusCounts?.shipped ?? 0 }, { label: "Delivered", value: supplierPortal?.orderStatusCounts?.delivered ?? 0 }, { label: "Refunded", value: supplierPortal?.orderStatusCounts?.refunded ?? 0 }, { label: "Cancelled", value: supplierPortal?.orderStatusCounts?.cancelled ?? 0 }]} />
      <StatisticsCard title="Total Revenue" value={formatCurrency(supplierPortal?.totalRevenue ?? 0)} description="Revenue from your products (excl. cancelled)" icon={DollarSign} variant="amber" valueLoading={supplierCardsLoading} badgeValuesLoading={supplierCardsLoading} badges={[{ label: "Paid", value: formatCurrency(supplierPortal?.revenueBreakdown?.paid ?? 0) }, { label: "Partial", value: formatCurrency(supplierPortal?.revenueBreakdown?.partial ?? 0) }, { label: "Due", value: formatCurrency(supplierPortal?.revenueBreakdown?.due ?? 0) }, { label: "Refund", value: formatCurrency(supplierPortal?.revenueBreakdown?.refund ?? 0) }, { label: "Pending", value: formatCurrency(supplierPortal?.revenueBreakdown?.pending ?? 0) }, { label: "Avg/Order", value: formatCurrency(supplierAvgOrder) }]} />
    </div>}

    {isAdminProductsPage && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pb-6 items-stretch">
      <StatisticsCard title="Total Products" value={dashboard?.counts.products ?? 0} description="Products availability" icon={Package} variant="rose" valueLoading={dashboardCardsLoading} badgeValuesLoading={dashboardCardsLoading} badges={[{ label: "Available", value: dashboard?.productStatusBreakdown?.available ?? 0 }, { label: "Stock low", value: dashboard?.productStatusBreakdown?.stockLow ?? 0 }, { label: "Stock out", value: dashboard?.productStatusBreakdown?.stockOut ?? 0 }]} />
      <StatisticsCard title="Valor estimado de venta" value={formatCurrency(warehouseInventoryStats.saleTotal)} description="Estimated sale value at current prices" icon={DollarSign} variant="violet" valueLoading={dashboardCardsLoading || warehouseCardsLoading} badgeValuesLoading={warehouseCardsLoading} badges={warehouseSaleBadges} />
      <StatisticsCard title="Valor de inventario (costo)" value={formatCurrency(warehouseInventoryStats.costTotal)} description="Total inventory at purchase cost" icon={DollarSign} variant="blue" valueLoading={dashboardCardsLoading || warehouseCardsLoading} badgeValuesLoading={warehouseCardsLoading} badges={warehouseCostBadges} />
      <StatisticsCard title="Categories" value={dashboard?.counts.categories ?? 0} description="Product categories" icon={FolderTree} variant="amber" valueLoading={dashboardCardsLoading} badgeValuesLoading={dashboardCardsLoading} badges={[{ label: "Active", value: dashboard?.categoryStatusBreakdown?.active ?? 0 }, { label: "Inactive", value: dashboard?.categoryStatusBreakdown?.inactive ?? 0 }]} />
    </div>}

    {isUserProductsPage && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-stretch pb-6">
      <StatisticsCard title="Total Products" value={productsPageStats?.counts.products ?? 0} description="Products availability" icon={Package} variant="rose" valueLoading={dashboardCardsLoading} badgeValuesLoading={dashboardCardsLoading} badges={[{ label: "Available", value: productsPageStats?.productStatusBreakdown?.available ?? 0 }, { label: "Stock low", value: productsPageStats?.productStatusBreakdown?.stockLow ?? 0 }, { label: "Stock out", value: productsPageStats?.productStatusBreakdown?.stockOut ?? 0 }]} />
      <StatisticsCard title="Valor estimado de venta" value={formatCurrency(warehouseInventoryStats.saleTotal)} description="Estimated sale value at current prices" icon={DollarSign} variant="violet" valueLoading={dashboardCardsLoading || warehouseCardsLoading} badgeValuesLoading={warehouseCardsLoading} badges={warehouseSaleBadges} />
      <StatisticsCard title="Valor de inventario (costo)" value={formatCurrency(warehouseInventoryStats.costTotal)} description="Total inventory at purchase cost" icon={DollarSign} variant="blue" valueLoading={dashboardCardsLoading || warehouseCardsLoading} badgeValuesLoading={warehouseCardsLoading} badges={warehouseCostBadges} />
      <StatisticsCard title="Categories" value={productsPageStats?.counts.categories ?? 0} description="Product categories" icon={FolderTree} variant="amber" valueLoading={dashboardCardsLoading} badgeValuesLoading={dashboardCardsLoading} badges={[{ label: "Active", value: productsPageStats?.categoryStatusBreakdown?.active ?? 0 }, { label: "Inactive", value: productsPageStats?.categoryStatusBreakdown?.inactive ?? 0 }]} />
    </div>}

    <div className="pb-6 flex justify-center"><div className={APP_SHELL_WIDTH_CLASS}><ProductFilters searchTerm={searchTerm} setSearchTerm={setSearchTerm} pagination={pagination} setPagination={setPagination} allProducts={allProducts} allCategories={allCategories} allSuppliers={allSuppliers} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} selectedStatuses={selectedStatuses} setSelectedStatuses={setSelectedStatuses} selectedSuppliers={selectedSuppliers} setSelectedSuppliers={setSelectedSuppliers} userId={user?.id || ""} hideImport={isSupplierProductsPage} /></div></div>
    <ProductTable data={allProducts || []} columns={columns} userId={user?.id || ""} isLoading={tableDataLoading} searchTerm={searchTerm} pagination={pagination} setPagination={setPagination} selectedCategory={selectedCategory} selectedStatuses={selectedStatuses} selectedSuppliers={selectedSuppliers} />
  </div>;
});

ProductList.displayName = "ProductList";
export default ProductList;
