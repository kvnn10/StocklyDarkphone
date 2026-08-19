import { AlertDialogWrapper } from "@/components/dialogs";
import { useProductStore } from "@/stores";
import { useDeleteProduct } from "@/hooks/queries";
import { logger } from "@/lib/logger";

export function DeleteDialog() {
  // Keep UI state in Zustand (openDialog, selectedProduct)
  const {
    openDialog,
    setOpenDialog,
    setSelectedProduct,
    selectedProduct,
  } = useProductStore();

  // Use TanStack Query mutation for delete operation
  const deleteProductMutation = useDeleteProduct();

  async function deleteProductFx() {
    if (selectedProduct) {
      try {
        await deleteProductMutation.mutateAsync(selectedProduct.id);
        setOpenDialog(false);
        setSelectedProduct(null);
      } catch (error) {
        logger.error("Delete error:", error);
      }
    }
  }

  return (
    <AlertDialogWrapper
      open={openDialog}
      onOpenChange={(open: boolean) => {
        setOpenDialog(open);
        if (!open) {
          setSelectedProduct(null);
        }
      }}
      title="¿Estás completamente seguro?"
      description="Esta acción no se puede deshacer. El producto se eliminará de forma permanente."
      actionLabel="Eliminar"
      actionLoadingLabel="Eliminando..."
      isLoading={deleteProductMutation.isPending}
      onAction={deleteProductFx}
      onCancel={() => {
        setSelectedProduct(null);
      }}
    />
  );
}
