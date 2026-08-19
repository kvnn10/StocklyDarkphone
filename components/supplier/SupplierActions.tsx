"use client";

import { useState } from "react";
import { Supplier } from "@/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCreateSupplier, useDeleteSupplier } from "@/hooks/queries";
import { useAuth } from "@/contexts";
import { logger } from "@/lib/logger";
import { clearBodyScrollLock } from "@/lib/utils";
import { AlertDialogWrapper } from "@/components/dialogs";
import { useRouter } from "next/navigation";
import { MoreVertical, Eye, Edit, Trash2, Copy } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { DIALOG_TABLE_ACTION_ICON } from "@/components/shared/dialog-edge-scroll";
import type { TableColumnContext } from "@/components/category/CategoryTableColumns";

interface SupplierActionsProps { row: { original: Supplier }; onEdit: (supplier: Supplier) => void; onBeforeNavigate?: () => void; context?: TableColumnContext; }
export default function SupplierActions({ row, onEdit, onBeforeNavigate, context = "page" }: SupplierActionsProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { user } = useAuth(); const router = useRouter();
  const createSupplierMutation = useCreateSupplier(); const deleteSupplierMutation = useDeleteSupplier();
  const isCopying = createSupplierMutation.isPending; const isDeleting = deleteSupplierMutation.isPending; const isGlobalDemo = Boolean(row.original.isGlobalDemo);
  const handleViewDetails = () => { if (onBeforeNavigate) { onBeforeNavigate(); clearBodyScrollLock(); const href = `/suppliers/${row.original.id}`; setTimeout(() => router.push(href), 150); } else router.push(`/suppliers/${row.original.id}`); };
  const handleCopySupplier = async () => { try { if (!user?.id) { logger.error("Se requiere el ID del usuario para duplicar el proveedor"); return; } await createSupplierMutation.mutateAsync({ name: `${row.original.name} (copia)`, userId: user.id, status: row.original.status ?? true, description: row.original.description, notes: row.original.notes }); } catch (error) { logger.error("Error al duplicar el proveedor:", error); } };
  const handleEditSupplier = () => { try { onEdit(row.original); } catch (error) { logger.error("Error al abrir el diálogo de edición:", error); } };
  const handleDeleteSupplier = async () => { try { await deleteSupplierMutation.mutateAsync(row.original.id); setDeleteDialogOpen(false); } catch (error) { logger.error("Error al eliminar el proveedor:", error); } };
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><span className="sr-only">Abrir menú</span><MoreVertical className={cn("h-4 w-4", context === "dialog" ? DIALOG_TABLE_ACTION_ICON : "text-gray-600 dark:text-gray-300")} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border border-white/10 bg-gradient-to-br from-white/5 via-white/5 to-white/5 backdrop-blur-md shadow-lg">
        {onBeforeNavigate ? <DropdownMenuItem onClick={handleViewDetails} className="flex items-center gap-2"><Eye className="h-4 w-4" />Ver detalles</DropdownMenuItem> : <DropdownMenuItem asChild><Link href={`/suppliers/${row.original.id}`} className="flex items-center gap-2"><Eye className="h-4 w-4" />Ver detalles</Link></DropdownMenuItem>}
        <DropdownMenuItem onClick={handleCopySupplier} disabled={isCopying || isGlobalDemo} className="flex items-center gap-2"><Copy className="h-4 w-4" />{isCopying ? "Duplicando..." : "Crear copia"}</DropdownMenuItem>
        <DropdownMenuItem onClick={handleEditSupplier} disabled={isGlobalDemo} className="flex items-center gap-2"><Edit className="h-4 w-4" />Editar proveedor</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)} disabled={isDeleting || isGlobalDemo} className="flex items-center gap-2 text-red-600 dark:text-red-400"><Trash2 className="h-4 w-4" />{isDeleting ? "Eliminando..." : "Eliminar proveedor"}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AlertDialogWrapper open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} title="¿Estás completamente seguro?" description={`Esta acción no se puede deshacer. El proveedor "${row.original.name}" se eliminará de forma permanente.`} actionLabel="Eliminar" actionLoadingLabel="Eliminando..." isLoading={isDeleting} onAction={handleDeleteSupplier} onCancel={() => setDeleteDialogOpen(false)} actionVariant="destructive" />
  </>;
}
