/**
 * REQ-0138 — resumen de asignación del catálogo para el detalle del producto.
 */
"use client";

import { cn } from "@/lib/utils";

export type CatalogAllocationSummaryTextProps = {
  catalogQty: number;
  allocatedTotal: number;
  unallocated: number;
  reservedCommitment?: number;
  className?: string;
};

export function CatalogAllocationSummaryText({ catalogQty, allocatedTotal, unallocated, reservedCommitment = 0, className }: CatalogAllocationSummaryTextProps) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs sm:text-sm font-normal text-gray-600 dark:text-white/80", className)}>
      <span>Catálogo <span className="text-gray-700 dark:text-gray-300 font-medium">{catalogQty}</span></span>
      <span className="text-gray-400 dark:text-white/80" aria-hidden>·</span>
      <span>Asignadas <span className="text-sky-600 dark:text-sky-400 font-medium">{allocatedTotal}</span></span>
      <span className="text-gray-400 dark:text-white/80" aria-hidden>·</span>
      <span>Sin asignar <span className="text-emerald-600 dark:text-emerald-400 font-medium">{unallocated}</span></span>
      {reservedCommitment > 0 ? <><span className="text-gray-400 dark:text-white/80" aria-hidden>·</span><span><span className="text-amber-600 dark:text-amber-400 font-medium">{reservedCommitment}</span> reservadas</span></> : null}
    </span>
  );
}