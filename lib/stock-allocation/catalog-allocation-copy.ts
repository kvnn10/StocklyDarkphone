/**
 * REQ-0102 — texto compartido para inventario, asignado y disponible.
 */
export function formatCatalogAllocationSummary(catalogQty: number, allocatedTotal: number, unallocated: number): string {
  return `Inventario ${catalogQty} · Asignado ${allocatedTotal} · Disponible ${unallocated}`;
}

/** REQ-0107 — detalle de producto con compromiso reservado. */
export function formatCatalogAllocationDetailSummary(catalogQty: number, allocatedTotal: number, unallocated: number, reservedCommitment: number): string {
  const base = formatCatalogAllocationSummary(catalogQty, allocatedTotal, unallocated);
  if (reservedCommitment <= 0) return base;
  return `${base} · ${reservedCommitment} Reservado`;
}

/** REQ-0114 — pedidos comprometidos a nivel de inventario. */
export function formatCatalogCommitWarehouseHint(catalogCommitted: number): string {
  if (catalogCommitted <= 0) return "";
  return `${catalogCommitted} en pedidos del inventario — la fila del almacén no cambia hasta completar el pedido`;
}
