"use client";

import { useState } from "react";
import { Category } from "@/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCreateCategory, useDeleteCategory } from "@/hooks/queries";
import { useAuth } from "@/contexts";
import { logger } from "@/lib/logger";
import { AlertDialogWrapper } from "@/components/dialogs";
import { MoreVertical, Eye, Edit, Trash2, Copy } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { DIALOG_TABLE_ACTION_ICON } from "@/components/shared/dialog-edge-scroll";
import type { TableColumnContext } from "@/components/category/CategoryTableColumns";

interface CategoryActionsProps { row: { original: Category }; onEdit: (category: Category) => void; context?: TableColumnContext; }
export default function CategoryActions({ row, onEdit, context = "page" }: CategoryActionsProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { user } = useAuth();
  const createCategoryMutation = useCreateCategory();
  const deleteCategoryMutation = useDeleteCategory();
  const isCopying = createCategoryMutation.isPending;
  const isDeleting = deleteCategoryMutation.isPending;
  const handleCopyCategory = async () => { try { if (!user?.id) { logger.error("Se requiere el ID del usuario para duplicar la categoría"); return; } await createCategoryMutation.mutateAsync({ name: `${row.original.name} (copia)`, userId: user.id, status: row.original.status ?? true, description: row.original.description, notes: row.original.notes }); } catch (error) { logger.error("Error al duplicar la categoría:", error); } };
  const handleEditCategory = () => { try { onEdit(row.original); } catch (error) { logger.error("Error al abrir el diálogo de edición:", error); } };
  const handleDeleteCategory = async () => { try { await deleteCategoryMutation.mutateAsync(row.original.id); setDeleteDialogOpen(false); } catch (error) { logger.error("Error al eliminar la categoría:", error); } };
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><span className="sr-only">Abrir menú</span><MoreVertical className={cn("h-4 w-4", context === "dialog" ? DIALOG_TABLE_ACTION_ICON : "text-gray-600 dark:text-gray-300")} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border border-white/10 bg-gradient-to-br from-white/5 via-white/5 to-white/5 backdrop-blur-md shadow-lg">
        <DropdownMenuItem asChild><Link href={`/categories/${row.original.id}`} className="flex items-center gap-2"><Eye className="h-4 w-4" />Ver detalles</Link></DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyCategory} disabled={isCopying} className="flex items-center gap-2"><Copy className="h-4 w-4" />{isCopying ? "Duplicando..." : "Crear copia"}</DropdownMenuItem>
        <DropdownMenuItem onClick={handleEditCategory} className="flex items-center gap-2"><Edit className="h-4 w-4" />Editar categoría</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)} disabled={isDeleting} className="flex items-center gap-2 text-red-600 dark:text-red-400"><Trash2 className="h-4 w-4" />{isDeleting ? "Eliminando..." : "Eliminar categoría"}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AlertDialogWrapper open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} title="¿Estás completamente seguro?" description={`Esta acción no se puede deshacer. La categoría "${row.original.name}" se eliminará de forma permanente.`} actionLabel="Eliminar" actionLoadingLabel="Eliminando..." isLoading={isDeleting} onAction={handleDeleteCategory} onCancel={() => setDeleteDialogOpen(false)} actionVariant="destructive" />
  </>;
}
