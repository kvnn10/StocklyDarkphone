import { Product } from "@/types";
import { useProductStore } from "@/stores";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCreateProduct, useDeleteProduct, useReviewEligibility, useReviewsByProduct, useDeleteProductReview } from "@/hooks/queries";
import { useAuth } from "@/contexts";
import { logger } from "@/lib/logger";
import { MoreVertical, Eye, Edit, Trash2, Copy, Star, Pencil, ClipboardList } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AlertDialogWrapper } from "@/components/dialogs";
import WriteEditReviewDialog from "@/components/product-reviews/WriteEditReviewDialog";
import type { ProductReview } from "@/types";

interface ProductsDropDownProps { row: { original: Product }; detailBase?: string; }

export default function ProductsDropDown({ row, detailBase = "" }: ProductsDropDownProps) {
  const { setSelectedProduct, setOpenProductDialog } = useProductStore();
  const { user } = useAuth();
  const createProductMutation = useCreateProduct();
  const deleteProductMutation = useDeleteProduct();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [editingReview, setEditingReview] = useState<ProductReview | null>(null);
  const [deleteReviewId, setDeleteReviewId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const productId = row.original.id;
  const productName = row.original.name;
  const { data: eligibility } = useReviewEligibility(productId, undefined, { enabled: menuOpen });
  const { data: reviews = [] } = useReviewsByProduct(productId, { status: "all", enabled: menuOpen });
  const deleteReviewMutation = useDeleteProductReview();
  const eligible = eligibility?.eligible ?? false;
  const firstSlot = eligibility?.slots?.[0];
  const myReviews = user ? reviews.filter((r) => r.userId === user.id) : [];
  const canWriteReview = eligible && firstSlot != null;
  const canEditOrDeleteReview = myReviews.length > 0;
  const isCopying = createProductMutation.isPending;
  const isDeleting = deleteProductMutation.isPending;
  const readOnlyCatalog = user?.role === "supplier" || user?.role === "client";

  const handleCopyProduct = async () => { try { await createProductMutation.mutateAsync({ name: `${row.original.name} (copia)`, sku: `${row.original.sku}-${Date.now()}`, price: row.original.price, purchasePrice: row.original.purchasePrice ?? 0, quantity: row.original.quantity, status: row.original.status || "Available", categoryId: row.original.categoryId, supplierId: row.original.supplierId, userId: row.original.userId }); } catch (error) { logger.error("Error copying product:", error); } };
  const handleEditProduct = () => { try { setSelectedProduct(row.original); setOpenProductDialog(true); } catch (error) { logger.error("Error opening edit dialog:", error); } };
  const handleOpenWriteReview = () => { setEditingReview(null); setReviewDialogOpen(true); };
  const handleOpenEditReview = () => { const first = myReviews[0]; if (first) { setEditingReview(first); setReviewDialogOpen(true); } };
  const handleReviewDialogClose = (open: boolean) => { setReviewDialogOpen(open); if (!open) setEditingReview(null); };
  const handleConfirmDeleteReview = () => { if (!deleteReviewId) return; deleteReviewMutation.mutate(deleteReviewId, { onSuccess: () => setDeleteReviewId(null), onError: () => setDeleteReviewId(null) }); };
  const handleConfirmDeleteProduct = () => { deleteProductMutation.mutate(row.original.id, { onSuccess: () => setDeleteDialogOpen(false), onError: () => setDeleteDialogOpen(false) }); };

  return <>
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><span className="sr-only">Abrir menú</span><MoreVertical className="h-4 w-4 text-gray-600 dark:text-gray-300" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border border-white/10 bg-gradient-to-br from-white/5 via-white/5 to-white/5 backdrop-blur-md shadow-lg">
        <DropdownMenuItem asChild><Link href={detailBase ? `${detailBase}/products/${row.original.id}` : `/products/${row.original.id}`} className="flex items-center gap-2"><Eye className="h-4 w-4" />Ver detalles</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href={`/admin/kardex?productId=${encodeURIComponent(productId)}`} className="flex items-center gap-2"><ClipboardList className="h-4 w-4" />Ver Kardex</Link></DropdownMenuItem>
        {!readOnlyCatalog && <>
          <DropdownMenuItem onClick={handleCopyProduct} disabled={isCopying} className="flex items-center gap-2"><Copy className="h-4 w-4" />{isCopying ? "Duplicando..." : "Crear duplicado"}</DropdownMenuItem>
          <DropdownMenuItem onClick={handleEditProduct} className="flex items-center gap-2"><Edit className="h-4 w-4" />Editar</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)} disabled={isDeleting} className="flex items-center gap-2 text-red-600 dark:text-red-400"><Trash2 className="h-4 w-4" />{isDeleting ? "Eliminando..." : "Eliminar producto"}</DropdownMenuItem>
        </>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleOpenWriteReview} disabled={!canWriteReview} className="flex items-center gap-2" title={canWriteReview ? undefined : "Compra este producto para escribir una reseña"}><Star className="h-4 w-4" />Escribir reseña</DropdownMenuItem>
        <DropdownMenuItem onClick={handleOpenEditReview} disabled={!canEditOrDeleteReview} className="flex items-center gap-2"><Pencil className="h-4 w-4" />Editar reseña</DropdownMenuItem>
        <DropdownMenuItem onClick={() => myReviews[0] && setDeleteReviewId(myReviews[0].id)} disabled={!canEditOrDeleteReview} className="flex items-center gap-2 text-red-600 dark:text-red-400"><Trash2 className="h-4 w-4" />Eliminar reseña</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <WriteEditReviewDialog open={reviewDialogOpen} onOpenChange={handleReviewDialogClose} productId={productId} productName={productName} orderId={editingReview ? undefined : firstSlot?.orderId} orderItemId={editingReview ? undefined : (firstSlot?.orderItemId ?? undefined)} existingReview={editingReview} />
    <AlertDialogWrapper open={!!deleteReviewId} onOpenChange={(open) => !open && setDeleteReviewId(null)} title="Eliminar reseña" description="¿Estás seguro de que quieres eliminar esta reseña? Esta acción no se puede deshacer." actionLabel="Eliminar" actionLoadingLabel="Eliminando..." isLoading={deleteReviewMutation.isPending} onAction={handleConfirmDeleteReview} onCancel={() => setDeleteReviewId(null)} />
    <AlertDialogWrapper open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} title="Eliminar producto" description={`¿Estás seguro de que quieres eliminar "${row.original.name}"? Esta acción no se puede deshacer.`} actionLabel="Eliminar" actionLoadingLabel="Eliminando..." isLoading={isDeleting} onAction={handleConfirmDeleteProduct} onCancel={() => setDeleteDialogOpen(false)} />
  </>;
}
