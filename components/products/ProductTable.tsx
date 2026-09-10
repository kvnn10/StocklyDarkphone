"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ColumnDef, flexRender, getCoreRowModel, getPaginationRowModel,
  getSortedRowModel, SortingState, useReactTable,
} from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Product } from "@/types";
import { TableBodyPulseRows } from "@/components/ui/table-data-skeleton";
import PaginationSelector, { type PaginationType } from "@/components/shared/PaginationSelector";
import { useClampPaginationIndex } from "@/hooks/use-clamp-pagination-index";
import { useStockAllocations } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { GrFormPrevious, GrFormNext } from "react-icons/gr";
import { LuGitPullRequestDraft } from "react-icons/lu";
import { IoMdClose } from "react-icons/io";
import { BiFirstPage, BiLastPage } from "react-icons/bi";
import { FaCheck } from "react-icons/fa";

interface DataTableProps<TData, TValue> {
  data: TData[]; columns: ColumnDef<TData, TValue>[]; userId: string; isLoading: boolean;
  searchTerm: string; pagination: PaginationType;
  setPagination: (updater: PaginationType | ((old: PaginationType) => PaginationType)) => void;
  selectedCategory: string[]; selectedStatuses: string[]; selectedSuppliers: string[];
}

function returnColor(status: string) {
  switch (status) { case "Available": return "text-green-600 bg-green-100"; case "Stock Out": return "text-red-600 bg-red-100"; case "Stock Low": return "text-orange-600 bg-orange-100"; default: return ""; }
}
function returnIcon(status: string) {
  switch (status) { case "Available": return <FaCheck />; case "Stock Out": return <IoMdClose />; case "Stock Low": return <LuGitPullRequestDraft />; default: return null; }
}

export const ProductTable = React.memo(function ProductTable({
  data, columns, userId, isLoading, searchTerm, pagination, setPagination,
  selectedCategory, selectedStatuses, selectedSuppliers,
}: DataTableProps<Product, unknown>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const allocationsQuery = useStockAllocations();
  const allocations = allocationsQuery.data ?? [];

  useEffect(() => {
    const readFilter = () => setWarehouseFilter(new URLSearchParams(window.location.search).get("warehouse") ?? "");
    readFilter();
    window.addEventListener("stockly:warehouse-filter", readFilter);
    window.addEventListener("popstate", readFilter);
    return () => {
      window.removeEventListener("stockly:warehouse-filter", readFilter);
      window.removeEventListener("popstate", readFilter);
    };
  }, []);

  const filteredData = useMemo(() => data.filter((product) => {
    const searchMatch = !searchTerm || product.name.toLowerCase().includes(searchTerm.toLowerCase()) || product.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const categoryMatch = selectedCategory.length === 0 || selectedCategory.includes(product.categoryId ?? "");
    const supplierMatch = selectedSuppliers.length === 0 || selectedSuppliers.includes(product.supplierId ?? "");
    const statusMatch = selectedStatuses.length === 0 || selectedStatuses.includes(product.status ?? "");
    const warehouseMatch = !warehouseFilter || allocations.some((a) => a.productId === product.id && a.warehouseId === warehouseFilter && Number(a.quantity ?? 0) > 0);
    return searchMatch && categoryMatch && supplierMatch && statusMatch && warehouseMatch;
  }), [data, searchTerm, selectedCategory, selectedSuppliers, selectedStatuses, warehouseFilter, allocations]);

  useClampPaginationIndex(filteredData.length, pagination, setPagination);

  const table = useReactTable({
    data: filteredData || [], columns, state: { pagination, sorting },
    onSortingChange: setSorting, onPaginationChange: setPagination, autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(), getPaginationRowModel: getPaginationRowModel(), getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="poppins mt-0">
      <div className="rounded-[28px] border border-rose-400/20 dark:border-white/10 shadow-[0_30px_80px_rgba(225,29,72,0.25)] dark:shadow-[0_30px_80px_rgba(225,29,72,0.15)] bg-gradient-to-br from-white/20 via-white/15 to-white/10 dark:from-white/5 dark:via-white/5 dark:to-white/5 backdrop-blur-md overflow-hidden">
        <Table>
          <TableHeader>{table.getHeaderGroups().map((headerGroup) => <TableRow key={headerGroup.id} className="bg-white/40 dark:bg-white/10">{headerGroup.headers.map((header) => <TableHead key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader>
          {isLoading ? <TableBodyPulseRows rows={pagination.pageSize} columnCount={columns.length} /> : <TableBody>
            {table.getRowModel().rows?.length ? table.getRowModel().rows.map((row, index) => <TableRow key={row.id} data-state={row.getIsSelected() && "selected"} className={index % 2 === 0 ? "bg-white/30 dark:bg-white/5" : "bg-white/20 dark:bg-white/10"}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>) : <TableRow><TableCell colSpan={columns.length} className="text-center text-gray-700 dark:text-white">No products added/found.</TableCell></TableRow>}
          </TableBody>}
        </Table>
      </div>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 mt-4">
        <PaginationSelector pagination={pagination} setPagination={setPagination} variant="rose" layout="inline" enabled={!isLoading} />
        <div className="flex items-center justify-center sm:justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()} className="h-10 rounded-[28px] border border-rose-400/30 dark:border-rose-400/30 bg-gradient-to-r from-rose-500/25 via-rose-500/15 to-rose-500/10 text-gray-700 dark:text-white shadow-[0_10px_30px_rgba(225,29,72,0.2)] backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed"><BiFirstPage /></Button>
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="h-10 rounded-[28px] border border-rose-400/30 dark:border-rose-400/30 bg-gradient-to-r from-rose-500/25 via-rose-500/15 to-rose-500/10 text-gray-700 dark:text-white shadow-[0_10px_30px_rgba(225,29,72,0.2)] backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed"><GrFormPrevious /></Button>
          <span className="text-sm text-gray-500 dark:text-gray-300 whitespace-nowrap">Page {pagination.pageIndex + 1} of {table.getPageCount()}</span>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="h-10 rounded-[28px] border border-rose-400/30 dark:border-rose-400/30 bg-gradient-to-r from-rose-500/25 via-rose-500/15 to-rose-500/10 text-gray-700 dark:text-white shadow-[0_10px_30px_rgba(225,29,72,0.2)] backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed"><GrFormNext /></Button>
          <Button variant="outline" size="sm" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()} className="h-10 rounded-[28px] border border-rose-400/30 dark:border-rose-400/30 bg-gradient-to-r from-rose-500/25 via-rose-500/15 to-rose-500/10 text-gray-700 dark:text-white shadow-[0_10px_30px_rgba(225,29,72,0.2)] backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed"><BiLastPage /></Button>
        </div>
      </div>
    </div>
  );
});
