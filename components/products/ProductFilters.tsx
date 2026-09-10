"use client";

import { FILTER_SEARCH_INPUT_SKY_CLASS } from "@/lib/ui/filter-toolbar-styles";
import React, { useMemo, useCallback, useEffect, useState } from "react";
import { Product, Category, Supplier, StockAllocation, Warehouse } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import Papa from "papaparse";
import { IoClose } from "react-icons/io5";
import { Search, Users, Warehouse as WarehouseIcon } from "lucide-react";
import ExcelJS from "exceljs";
import { CategoryDropDown } from "@/components/category/CategoryFilter";
import { StatusDropDown } from "./ProductStatusFilter";
import { SuppliersDropDown } from "@/components/supplier/SupplierFilter";
import { PaginationType } from "@/components/shared/PaginationSelector";
import { DismissibleFilterChips, ExportMenuButton } from "@/components/shared";
import type { FilterChipGroup } from "@/components/shared";
import { ProductImportDialog } from "./ProductImportDialog";
import { ProductOwnerSelect } from "./ProductOwnerSelect";
import { ProductStockStatusBadge } from "@/lib/ui/semantic-badges";
import { FILTER_CHIP_COLLAPSED_CLASS } from "@/lib/ui/filter-chip-styles";
import { cn } from "@/lib/utils";
import { formatStableDate } from "@/lib/format";
import { useWarehouses, useStockAllocations, useProductVariants } from "@/hooks/queries";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FilterCommandCheckboxItem } from "@/lib/ui/filter-command-item";
import { Separator } from "@/components/ui/separator";
import {
  filterCommandPopoverClass,
  FILTER_COMMAND_INPUT_WRAPPER_CLASS,
} from "@/lib/ui/popover-readability-styles";

type FiltersAndActionsProps = {
  allProducts: Product[];
  allCategories: Category[];
  allSuppliers: Supplier[];
  allWarehouses?: Warehouse[];
  stockAllocations?: StockAllocation[];
  categoriesOverride?: Array<{ id: string; name: string }>;
  suppliersOverride?: Array<{ id: string; name: string; image?: string | null }>;
  hideImport?: boolean;
  productOwnerOptions?: Array<{ id: string; name: string; email: string; image?: string | null }>;
  storeOwnerCounts?: { total: number; withProducts: number };
  selectedOwnerId?: string;
  onOwnerChange?: (ownerId: string) => void;
  selectedCategory: string[];
  setSelectedCategory: React.Dispatch<React.SetStateAction<string[]>>;
  selectedStatuses: string[];
  setSelectedStatuses: React.Dispatch<React.SetStateAction<string[]>>;
  selectedSuppliers: string[];
  setSelectedSuppliers: React.Dispatch<React.SetStateAction<string[]>>;
  selectedWarehouse?: string;
  setSelectedWarehouse?: React.Dispatch<React.SetStateAction<string>>;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  pagination: PaginationType;
  setPagination: (updater: PaginationType | ((old: PaginationType) => PaginationType)) => void;
  userId: string;
};

export default function FiltersAndActions({
  allProducts, allCategories, allSuppliers, allWarehouses: warehouseProp = [], stockAllocations: allocationProp = [],
  categoriesOverride, suppliersOverride, hideImport = false, productOwnerOptions, storeOwnerCounts,
  selectedOwnerId = "", onOwnerChange, selectedCategory, setSelectedCategory, selectedStatuses,
  setSelectedStatuses, selectedSuppliers, setSelectedSuppliers, searchTerm, setSearchTerm, pagination, setPagination, userId,
}: FiltersAndActionsProps) {
  const { toast } = useToast();
  const warehousesQuery = useWarehouses();
  const allocationsQuery = useStockAllocations();
  const variantsQuery = useProductVariants();
  const allWarehouses = warehouseProp.length ? warehouseProp : (warehousesQuery.data ?? []);
  const stockAllocations = allocationProp.length ? allocationProp : (allocationsQuery.data ?? []);
  const variants = variantsQuery.data ?? [];
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [warehouseOpen, setWarehouseOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSelectedWarehouse(params.get("warehouse") ?? "");
  }, []);

  const updateWarehouse = useCallback((warehouseId: string) => {
    setSelectedWarehouse(warehouseId);
    setWarehouseOpen(false);
    const url = new URL(window.location.href);
    if (warehouseId) url.searchParams.set("warehouse", warehouseId);
    else url.searchParams.delete("warehouse");
    window.history.replaceState({}, "", url.toString());
    window.dispatchEvent(new Event("stockly:warehouse-filter"));
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [setPagination]);

  const filteredProducts = useMemo(() => allProducts.filter((product) => {
    const searchMatch = !searchTerm || product.name.toLowerCase().includes(searchTerm.toLowerCase()) || product.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const categoryMatch = selectedCategory.length === 0 || selectedCategory.includes(product.categoryId ?? "");
    const supplierMatch = selectedSuppliers.length === 0 || selectedSuppliers.includes(product.supplierId ?? "");
    const statusMatch = selectedStatuses.length === 0 || selectedStatuses.includes(product.status ?? "");
    const productStockMatch = stockAllocations.some((a) => a.productId === product.id && a.warehouseId === selectedWarehouse && Number(a.quantity ?? 0) > 0);
    const variantStockMatch = variants.some((variant) => variant.productId === product.id && variant.stocks.some((stock) => stock.warehouseId === selectedWarehouse && Number(stock.quantity ?? 0) > 0));
    const warehouseMatch = !selectedWarehouse || productStockMatch || variantStockMatch;
    return searchMatch && categoryMatch && supplierMatch && statusMatch && warehouseMatch;
  }), [allProducts, searchTerm, selectedCategory, selectedSuppliers, selectedStatuses, selectedWarehouse, stockAllocations, variants]);

  const exportToCSV = useCallback(() => {
    try {
      if (filteredProducts.length === 0) { toast({ title: "No Data to Export", description: "There are no products to export with the current filters.", variant: "destructive" }); return; }
      const csvData = filteredProducts.map((product) => ({ "Product Name": product.name, SKU: product.sku, Price: `$${product.price.toFixed(2)}`, Quantity: product.quantity, Status: product.status, Category: product.category || "Unknown", Supplier: product.supplier || "Unknown", "Created Date": formatStableDate(product.createdAt) }));
      const csv = Papa.unparse(csvData); const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" }); const link = document.createElement("a"); const url = URL.createObjectURL(blob);
      link.setAttribute("href", url); link.setAttribute("download", `stockly-products-${new Date().toISOString().split("T")[0]}.csv`); link.style.visibility = "hidden"; document.body.appendChild(link); link.click(); document.body.removeChild(link);
      toast({ title: "CSV Export Successful!", description: `${filteredProducts.length} products exported to CSV file.` });
    } catch { toast({ title: "Export Failed", description: "Failed to export products to CSV. Please try again.", variant: "destructive" }); }
  }, [filteredProducts, toast]);

  const exportToExcel = useCallback(async () => {
    try {
      if (filteredProducts.length === 0) { toast({ title: "No Data to Export", description: "There are no products to export with the current filters.", variant: "destructive" }); return; }
      const excelData = filteredProducts.map((product) => ({ "Product Name": product.name, SKU: product.sku, Price: product.price, Quantity: product.quantity, Status: product.status, Category: product.category || "Unknown", Supplier: product.supplier || "Unknown", "Created Date": formatStableDate(product.createdAt) }));
      const workbook = new ExcelJS.Workbook(); const worksheet = workbook.addWorksheet("Products");
      worksheet.columns = [{ header: "Product Name", key: "Product Name", width: 20 }, { header: "SKU", key: "SKU", width: 15 }, { header: "Price", key: "Price", width: 10 }, { header: "Quantity", key: "Quantity", width: 10 }, { header: "Status", key: "Status", width: 12 }, { header: "Category", key: "Category", width: 15 }, { header: "Supplier", key: "Supplier", width: 15 }, { header: "Created Date", key: "Created Date", width: 12 }];
      worksheet.addRows(excelData); worksheet.getRow(1).font = { bold: true }; worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };
      const buffer = await workbook.xlsx.writeBuffer(); const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); const link = document.createElement("a"); const url = URL.createObjectURL(blob);
      link.setAttribute("href", url); link.setAttribute("download", `stockly-products-${new Date().toISOString().split("T")[0]}.xlsx`); link.style.visibility = "hidden"; document.body.appendChild(link); link.click(); document.body.removeChild(link);
      toast({ title: "Excel Export Successful!", description: `${filteredProducts.length} products exported to Excel file.` });
    } catch { toast({ title: "Export Failed", description: "Failed to export products to Excel. Please try again.", variant: "destructive" }); }
  }, [filteredProducts, toast]);

  const handleResetFilters = useCallback(() => { setSelectedStatuses([]); setSelectedCategory([]); setSelectedSuppliers([]); updateWarehouse(""); setPagination((prev) => ({ ...prev, pageIndex: 0 })); }, [setSelectedStatuses, setSelectedCategory, setSelectedSuppliers, updateWarehouse, setPagination]);

  const filterChipGroups = useMemo((): FilterChipGroup[] => {
    const categoryNameById = new Map(allCategories.map((c) => [c.id, c.name]));
    const supplierNameById = new Map(allSuppliers.map((s) => [s.id, s.name]));
    const warehouseNameById = new Map(allWarehouses.map((w) => [w.id, w.name]));
    return [
      { label: "Status", values: selectedStatuses, onClear: () => setSelectedStatuses([]), renderBadge: (value) => <ProductStockStatusBadge status={value} size="compact" /> },
      { label: "Category", values: selectedCategory, onClear: () => setSelectedCategory([]), renderBadge: (value) => <span className={FILTER_CHIP_COLLAPSED_CLASS}>{categoryNameById.get(value) ?? value}</span> },
      { label: "Supplier", values: selectedSuppliers, onClear: () => setSelectedSuppliers([]), renderBadge: (value) => <span className={FILTER_CHIP_COLLAPSED_CLASS}>{supplierNameById.get(value) ?? value}</span> },
      { label: "Bodega", values: selectedWarehouse ? [selectedWarehouse] : [], onClear: () => updateWarehouse(""), renderBadge: (value) => <span className={FILTER_CHIP_COLLAPSED_CLASS}>{warehouseNameById.get(value) ?? value}</span> },
    ];
  }, [allCategories, allSuppliers, allWarehouses, selectedStatuses, selectedCategory, selectedSuppliers, selectedWarehouse, setSelectedStatuses, setSelectedCategory, setSelectedSuppliers, updateWarehouse]);

  const exportButtonClass = "h-10 w-full sm:w-auto flex items-center gap-2 rounded-[28px] border border-violet-400/30 dark:border-violet-400/30 bg-gradient-to-r from-violet-500/25 via-violet-500/15 to-violet-500/10 text-gray-700 dark:text-white shadow-[0_10px_30px_rgba(139,92,246,0.2)] backdrop-blur-md transition duration-200";

  return <div className="flex flex-col gap-2">
    {productOwnerOptions && onOwnerChange && <div className="flex flex-wrap items-center justify-center gap-3 w-full py-1"><p className="text-sm text-gray-700 dark:text-white/80 flex items-center gap-2 min-w-0"><Users className="h-4 w-4 text-violet-500 dark:text-violet-400 shrink-0" /><span className="truncate">{storeOwnerCounts && storeOwnerCounts.total > 0 ? <>{storeOwnerCounts.withProducts} of {storeOwnerCounts.total} store owners have products · Select Product Owner</> : "Select Product Owner"}</span></p><ProductOwnerSelect options={productOwnerOptions} selectedOwnerId={selectedOwnerId} onOwnerChange={onOwnerChange} triggerClassName={cn(exportButtonClass, "h-auto min-h-10")} /></div>}
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 flex-wrap w-full">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0 order-2 sm:order-1 w-full sm:w-auto">
        <SuppliersDropDown selectedSuppliers={selectedSuppliers} setSelectedSuppliers={setSelectedSuppliers} suppliersOverride={suppliersOverride} />
        <CategoryDropDown selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} categoriesOverride={categoriesOverride} />
        <div className="flex items-center poppins w-full sm:w-auto">
          <Popover open={warehouseOpen} onOpenChange={setWarehouseOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="secondary"
                className="h-10 w-full sm:w-auto min-w-[150px] rounded-[28px] border border-teal-400/30 dark:border-teal-400/30 bg-gradient-to-r from-teal-500/25 via-teal-500/15 to-teal-500/10 dark:from-teal-500/25 dark:via-teal-500/15 dark:to-teal-500/10 text-gray-700 dark:text-white shadow-[0_10px_30px_rgba(20,184,166,0.2)] backdrop-blur-md transition duration-200 hover:border-teal-300/40 hover:from-teal-500/35 hover:via-teal-500/25 hover:to-teal-500/15 dark:hover:border-teal-300/40 dark:hover:from-teal-500/35 dark:hover:via-teal-500/25 dark:hover:to-teal-500/15 justify-start"
              >
                <WarehouseIcon className="h-4 w-4 mr-1" aria-hidden />
                <span className="truncate">{selectedWarehouse ? (allWarehouses.find((w) => w.id === selectedWarehouse)?.name ?? "Bodega") : "Bodega"}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className={cn("p-0 w-56 poppins", filterCommandPopoverClass("teal"), FILTER_COMMAND_INPUT_WRAPPER_CLASS)}
              side="bottom"
              align="end"
            >
              <Command className="p-1 bg-transparent">
                <CommandInput
                  placeholder="Buscar bodega..."
                  className="bg-transparent border-0 focus:ring-0 focus:outline-none text-gray-700 dark:text-white/80 placeholder:text-gray-500 dark:placeholder:text-white/40"
                />
                <CommandList>
                  <CommandEmpty className="text-gray-600 dark:text-white/80 text-sm text-center p-5">No se encontró ninguna bodega.</CommandEmpty>
                  <CommandGroup>
                    <FilterCommandCheckboxItem
                      value="Todas las bodegas"
                      toggleValue=""
                      checked={!selectedWarehouse}
                      onToggle={() => updateWarehouse("")}
                      className="h-9 focus:bg-teal-100 dark:focus:bg-white/10"
                      checkboxClassName="focus:ring-teal-500/50"
                    >
                      <div className="flex items-center gap-1 p-1 rounded-lg px-2 text-[14px]">Todas las bodegas</div>
                    </FilterCommandCheckboxItem>
                    {allWarehouses.filter((w) => w.status !== false).map((warehouse) => (
                      <FilterCommandCheckboxItem
                        key={warehouse.id}
                        value={warehouse.name}
                        toggleValue={warehouse.id}
                        checked={selectedWarehouse === warehouse.id}
                        onToggle={() => updateWarehouse(warehouse.id)}
                        className="h-9 focus:bg-teal-100 dark:focus:bg-white/10"
                        checkboxClassName="focus:ring-teal-500/50"
                      >
                        <div className="flex items-center gap-1 p-1 rounded-lg px-2 text-[14px]">{warehouse.name}</div>
                      </FilterCommandCheckboxItem>
                    ))}
                  </CommandGroup>
                </CommandList>
                <div className="flex flex-col gap-2 text-[23px]">
                  <Separator className="bg-gray-300/50 dark:bg-white/10" />
                  <Button onClick={() => updateWarehouse("")} variant="ghost" className="text-[12px] mb-1 text-gray-700 dark:text-white/80 hover:text-gray-700 dark:hover:text-white hover:bg-teal-100 dark:hover:bg-white/10">Limpiar filtros</Button>
                </div>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="relative flex-1 min-w-[120px] sm:min-w-[200px] sm:max-w-md w-full order-1 sm:order-2 sm:flex sm:justify-center"><div className="relative w-full sm:max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600 dark:text-white/80 z-10" /><Input placeholder="Search by Name or SKU..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className={FILTER_SEARCH_INPUT_SKY_CLASS} />{searchTerm && <Button variant="ghost" size="sm" onClick={() => setSearchTerm("")} className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0 text-white/60 hover:text-white hover:bg-white/10 backdrop-blur-md"><IoClose className="h-4 w-4 text-gray-700 dark:text-white/80" /></Button>}</div></div>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0 order-3 w-full sm:w-auto sm:flex-wrap"><StatusDropDown selectedStatuses={selectedStatuses} setSelectedStatuses={setSelectedStatuses} />{!hideImport && <ProductImportDialog />}<ExportMenuButton label="Export Products" accent="violet" onExportCsv={exportToCSV} onExportExcel={exportToExcel} className="w-full sm:w-auto" /></div>
    </div>
    <DismissibleFilterChips groups={filterChipGroups} onReset={handleResetFilters} />
  </div>;
}
