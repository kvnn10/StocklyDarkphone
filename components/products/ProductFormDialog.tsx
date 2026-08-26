"use client";

import { useState, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProductStore } from "@/stores";
import { useCreateProduct, useUpdateProduct, useCategories, useSuppliers, useStockByProduct, useWarehouses, useCreateStockAllocation } from "@/hooks/queries";
import { useSyncDialogOpenState } from "@/hooks/use-sync-dialog-open-state";
import { planCatalogQuantityReconcile } from "@/lib/stock-allocation/catalog-quantity-reconcile";
import { formatCatalogAllocationSummary } from "@/lib/stock-allocation/catalog-allocation-copy";
import { useCatalogQuantityReconcilePreview } from "@/hooks/use-catalog-quantity-reconcile-preview";
import { AlertDialogWrapper } from "@/components/dialogs";
import { SelectEmptyContent } from "@/components/shared/SelectEmptyContent";
import { resolveSelectPlaceholder } from "@/lib/ui/select-empty-copy";
import type { UpdateProductInput, Product } from "@/types";
import { logger } from "@/lib/logger";
import ProductName from "./form-fields/NameField";
import SKU from "./form-fields/SKUField";
import Quantity from "./form-fields/QuantityField";
import Price from "./form-fields/PriceField";
import ImageField from "./form-fields/ImageField";
import ExpirationDateField from "./form-fields/ExpirationDateField";
import { productSchema, productFormSubmitSchema, calculateProductStatus, type ProductFormData } from "@/lib/validations";
import {
  DeferredSelectGate,
  DIALOG_EDGE_SCROLL_BODY,
  DIALOG_EDGE_SCROLL_HEADER,
  DIALOG_EDGE_SCROLL_INNER,
  DIALOG_EDGE_SCROLL_SHELL,
  DIALOG_FORM_FIELD_ROSE,
  DIALOG_FORM_ERROR_TEXT,
  DIALOG_FORM_FEEDBACK_ROW,
  DIALOG_FORM_HINT_TEXT,
  DIALOG_FORM_WARN_TEXT,
  DIALOG_SELECT_CONTENT_CLASS,
  DIALOG_SELECT_ITEM_CLASS,
  DialogFormLabel,
  DialogHeaderBrand,
  DialogSubmitButton,
  GLASS_GHOST_BUTTON,
} from "@/components/shared";
import { AvatarInlineLink } from "@/components/shared/AvatarInlineLink";
import { cn } from "@/lib/utils";
import { Package, PackagePlus, Tag, Truck, Warehouse as WarehouseIcon, X } from "lucide-react";

interface AddProductDialogProps {
  allProducts: Product[];
  userId: string;
  children?: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}

export default function AddProductDialog({ allProducts, userId, children, onOpenChange }: AddProductDialogProps) {
  const methods = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: { productName: "", sku: "", quantity: "" as unknown as number, purchasePrice: 0, price: "" as unknown as number, imageUrl: "", imageFileId: "", expirationDate: "" },
  });
  const { reset, watch } = methods;
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [supplierError, setSupplierError] = useState("");
  const [warehouseError, setWarehouseError] = useState("");
  const [quantityReconcileError, setQuantityReconcileError] = useState("");
  const [shrinkConfirmOpen, setShrinkConfirmOpen] = useState(false);
  const [pendingUpdatePayload, setPendingUpdatePayload] = useState<UpdateProductInput | null>(null);
  const [pendingShrinkUnits, setPendingShrinkUnits] = useState(0);
  const [pendingCreatedProductId, setPendingCreatedProductId] = useState("");
  const dialogCloseRef = useRef<HTMLButtonElement | null>(null);

  const { setOpenProductDialog, openProductDialog, setSelectedProduct, selectedProduct } = useProductStore();
  const { data: categories = [], isLoading: categoriesLoading } = useCategories();
  const { data: suppliers = [], isLoading: suppliersLoading } = useSuppliers();
  const { data: warehouses = [], isLoading: warehousesLoading } = useWarehouses();
  const activeCategories = categories.filter((category) => category.status !== false || category.id === selectedCategory);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status !== false || supplier.id === selectedSupplier);
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.status !== false || warehouse.id === selectedWarehouse);
  const categoryInvite = resolveSelectPlaceholder("category", { count: activeCategories.length, isLoading: categoriesLoading, invite: "Seleccionar categoría" });
  const supplierInvite = resolveSelectPlaceholder("supplier", { count: activeSuppliers.length, isLoading: suppliersLoading, invite: "Seleccionar proveedor" });
  const warehouseInvite = warehousesLoading ? "Cargando bodegas…" : activeWarehouses.length === 0 ? "No hay bodegas disponibles" : "Seleccionar bodega";

  const createProductMutation = useCreateProduct();
  const updateProductMutation = useUpdateProduct();
  const createStockAllocationMutation = useCreateStockAllocation();
  const { data: productAllocations = [] } = useStockByProduct(selectedProduct?.id ?? "", undefined, { enabled: !!selectedProduct?.id });

  useSyncDialogOpenState(openProductDialog, () => {
    if (selectedProduct) {
      reset({
        productName: selectedProduct.name,
        sku: selectedProduct.sku,
        quantity: selectedProduct.quantity,
        purchasePrice: selectedProduct.purchasePrice ?? 0,
        price: selectedProduct.price,
        imageUrl: selectedProduct.imageUrl || "",
        imageFileId: selectedProduct.imageFileId || "",
        expirationDate: selectedProduct.expirationDate ? new Date(selectedProduct.expirationDate).toISOString().split("T")[0] : "",
      });
      setSelectedCategory(selectedProduct.categoryId || "");
      setSelectedSupplier(selectedProduct.supplierId || "");
      setSelectedWarehouse("");
    } else {
      reset({ productName: "", sku: "", quantity: "" as unknown as number, purchasePrice: 0, price: "" as unknown as number, imageUrl: "", imageFileId: "", expirationDate: "" });
      setSelectedCategory("");
      setSelectedSupplier("");
      setSelectedWarehouse("");
    }
    setCategoryError("");
    setSupplierError("");
    setWarehouseError("");
    setQuantityReconcileError("");
    setPendingCreatedProductId("");
  }, selectedProduct?.id ?? "create");

  const submitProductUpdate = async (payload: UpdateProductInput) => {
    await updateProductMutation.mutateAsync(payload);
    setOpenProductDialog(false);
    setShrinkConfirmOpen(false);
    setPendingUpdatePayload(null);
    setPendingShrinkUnits(0);
  };

  const onSubmit = async (data: ProductFormData) => {
    const submitValidation = productFormSubmitSchema.safeParse({ ...data, categoryId: selectedCategory, supplierId: selectedSupplier });
    if (!submitValidation.success) {
      for (const issue of submitValidation.error.errors) {
        const field = issue.path[0];
        if (field === "categoryId") setCategoryError(issue.message);
        if (field === "supplierId") setSupplierError(issue.message);
      }
      return;
    }
    setCategoryError("");
    setSupplierError("");
    const quantity = typeof data.quantity === "string" && data.quantity === "" ? 0 : Number(data.quantity);
    const purchasePrice = typeof data.purchasePrice === "string" && data.purchasePrice === "" ? 0 : Number(data.purchasePrice);
    const price = typeof data.price === "string" && data.price === "" ? 0 : Number(data.price);
    const status = calculateProductStatus(quantity);
    const expirationDate = data.expirationDate && data.expirationDate !== "" ? new Date(data.expirationDate).toISOString() : null;

    if (!selectedProduct && quantity > 0 && !selectedWarehouse) {
      setWarehouseError(activeWarehouses.length === 0 ? "Debes crear al menos una bodega antes de ingresar stock." : "Selecciona la bodega donde quedará el stock inicial.");
      return;
    }
    setWarehouseError("");

    try {
      if (!selectedProduct) {
        let createdProductId = pendingCreatedProductId;
        if (!createdProductId) {
          const createdProduct = await createProductMutation.mutateAsync({
            name: data.productName, sku: data.sku, purchasePrice, price, quantity, status,
            categoryId: selectedCategory, supplierId: selectedSupplier, userId,
            imageUrl: data.imageUrl || undefined, imageFileId: data.imageFileId || undefined,
            expirationDate: expirationDate || undefined,
          });
          createdProductId = createdProduct.id;
          setPendingCreatedProductId(createdProductId);
        }

        if (quantity > 0 && selectedWarehouse) {
          try {
            await createStockAllocationMutation.mutateAsync({ productId: createdProductId, warehouseId: selectedWarehouse, quantity });
          } catch (allocationError) {
            logger.error("Error asignando el stock inicial a la bodega:", allocationError);
            setWarehouseError("El producto se creó, pero no se pudo asignar el stock a la bodega. Verifica la bodega e inténtalo de nuevo.");
            return;
          }
        }

        setPendingCreatedProductId("");
        dialogCloseRef.current?.click();
        setOpenProductDialog(false);
      } else {
        const reconcilePlan = planCatalogQuantityReconcile({
          currentCatalog: selectedProduct.quantity,
          newCatalog: quantity,
          productReserved: selectedProduct.reservedQuantity ?? 0,
          allocations: productAllocations.map((row) => ({ id: row.id, quantity: row.quantity, reservedQuantity: row.reservedQuantity })),
        });
        if (!reconcilePlan.ok) {
          setQuantityReconcileError(reconcilePlan.blockedReason ?? "No se puede reducir la cantidad del inventario con las asignaciones actuales del almacén.");
          return;
        }
        setQuantityReconcileError("");
        const updatePayload: UpdateProductInput = {
          id: selectedProduct.id, name: data.productName, sku: data.sku, purchasePrice, price, quantity, status,
          categoryId: selectedCategory, supplierId: selectedSupplier,
          imageUrl: data.imageUrl || undefined, imageFileId: data.imageFileId || undefined, expirationDate,
        };
        const additionalUnits = Math.max(0, quantity - Number(selectedProduct.quantity));
        if (additionalUnits > 0 && !selectedWarehouse) {
          setWarehouseError(activeWarehouses.length === 0 ? "Debes crear al menos una bodega antes de aumentar el inventario." : "Selecciona la bodega donde quedarán las nuevas unidades.");
          return;
        }
        if (reconcilePlan.unitsRemoved > 0) {
          setPendingUpdatePayload(updatePayload);
          setPendingShrinkUnits(reconcilePlan.unitsRemoved);
          setShrinkConfirmOpen(true);
          return;
        }

        const previousQuantity = Number(selectedProduct.quantity);
        await updateProductMutation.mutateAsync(updatePayload);

        if (additionalUnits > 0 && selectedWarehouse) {
          const targetAllocation = productAllocations.find((row) => row.warehouseId === selectedWarehouse);
          const previousWarehouseQuantity = Number(targetAllocation?.quantity ?? 0);
          const nextWarehouseQuantity = previousWarehouseQuantity + additionalUnits;
          try {
            await createStockAllocationMutation.mutateAsync({
              productId: selectedProduct.id,
              warehouseId: selectedWarehouse,
              quantity: nextWarehouseQuantity,
            });
          } catch (allocationError) {
            logger.error("Error asignando las nuevas unidades a la bodega:", allocationError);
            try {
              await updateProductMutation.mutateAsync({
                ...updatePayload,
                quantity: previousQuantity,
                status: calculateProductStatus(previousQuantity),
              });
            } catch (rollbackError) {
              logger.error("Error revirtiendo el aumento de inventario:", rollbackError);
            }
            setWarehouseError("No se pudo asignar el aumento a la bodega seleccionada. El inventario fue revertido; verifica la bodega e inténtalo de nuevo.");
            return;
          }
        }

        setOpenProductDialog(false);
        setShrinkConfirmOpen(false);
        setPendingUpdatePayload(null);
        setPendingShrinkUnits(0);
      }
    } catch (error) {
      logger.error("Error en la operación del producto:", error);
    }
  };

  const isSubmitting = createProductMutation.isPending || updateProductMutation.isPending || createStockAllocationMutation.isPending;
  const allocationsForPreview = useMemo(() => {
    if (productAllocations.length > 0) return productAllocations;
    if (!selectedProduct || selectedProduct.allocatedTotal == null) return [];
    return [{ id: "__densify__", quantity: selectedProduct.allocatedTotal, reservedQuantity: Number(selectedProduct.committedQuantity ?? selectedProduct.reservedQuantity ?? 0) }];
  }, [productAllocations, selectedProduct]);
  const formValues = watch();
  const reconcilePreview = useCatalogQuantityReconcilePreview({ selectedProduct, allocations: allocationsForPreview, quantityRaw: formValues.quantity });
  const isFormValid = productFormSubmitSchema.safeParse({ ...formValues, categoryId: selectedCategory, supplierId: selectedSupplier }).success;
  const watchedQuantity = typeof formValues.quantity === "string" && formValues.quantity === "" ? 0 : Number(formValues.quantity || 0);
  const additionalUnitsToAllocate = selectedProduct ? Math.max(0, watchedQuantity - Number(selectedProduct.quantity)) : 0;
  const canSubmitUpdate = isFormValid && (!selectedProduct || reconcilePreview.ok) && (selectedProduct ? additionalUnitsToAllocate === 0 || !!selectedWarehouse : watchedQuantity === 0 || !!selectedWarehouse);

  const handleOpenChange = (open: boolean) => {
    setSelectedProduct(null);
    if (!open) setPendingCreatedProductId("");
    setOpenProductDialog(open);
    onOpenChange?.(open);
  };

  return (
    <Dialog open={openProductDialog} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children || <Button className="h-10 font-medium inline-flex items-center justify-center rounded-xl border border-rose-400/30 bg-gradient-to-r from-rose-500/40 via-rose-500/30 to-rose-500/20 text-white shadow-[0_15px_35px_rgba(225,29,72,0.35)] backdrop-blur-md transition duration-200 hover:border-rose-300/50">+ Agregar producto</Button>}
      </DialogTrigger>
      <DialogContent className={cn(DIALOG_EDGE_SCROLL_SHELL, "poppins border-rose-400/30 shadow-[0_30px_80px_rgba(225,29,72,0.35)]")} onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeaderBrand className={DIALOG_EDGE_SCROLL_HEADER} icon={Package} tone="rose" title={selectedProduct ? "Editar producto" : "Agregar producto"} description="Ingresa los detalles del producto a continuación." />
        <FormProvider {...methods}>
          <form onSubmit={methods.handleSubmit(onSubmit)} className={DIALOG_EDGE_SCROLL_BODY}>
            <div className={DIALOG_EDGE_SCROLL_INNER}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <ProductName />
                <SKU allProducts={allProducts} />
                <Quantity />
                <Price />
                <ExpirationDateField />
                <ImageField />
                {selectedProduct && allocationsForPreview.length > 0 ? (
                  <div className={DIALOG_FORM_FEEDBACK_ROW}>
                    <p className={DIALOG_FORM_HINT_TEXT}>{formatCatalogAllocationSummary(reconcilePreview.catalogPreviewQty, reconcilePreview.allocatedTotal, reconcilePreview.unallocatedPreview)}</p>
                    {reconcilePreview.reservedCommitment > 0 ? <p className={DIALOG_FORM_HINT_TEXT}>{reconcilePreview.reservedCommitment} reservadas en pedidos activos — el inventario no puede ser menor a esa cantidad</p> : null}
                    {!reconcilePreview.ok && reconcilePreview.blockedReason ? <p className={DIALOG_FORM_ERROR_TEXT} role="alert">{reconcilePreview.blockedReason}</p> : null}
                    {reconcilePreview.ok && reconcilePreview.shrinkUnits > 0 ? <p className={DIALOG_FORM_WARN_TEXT}>Se eliminarán {reconcilePreview.shrinkUnits} unidad(es) no reservada(s) de las asignaciones del almacén al guardar</p> : null}
                    {quantityReconcileError ? <p className={DIALOG_FORM_ERROR_TEXT} role="alert">{quantityReconcileError}</p> : null}
                  </div>
                ) : null}
                <div className="mt-5 flex flex-col gap-2">
                  <DialogFormLabel icon={Tag} required>Categoría</DialogFormLabel>
                  <DeferredSelectGate enabled={openProductDialog} placeholder={<div className={cn("flex h-11 w-full items-center rounded-md px-2 text-sm text-white/60", DIALOG_FORM_FIELD_ROSE)} aria-hidden>{activeCategories.find((c) => c.id === selectedCategory)?.name ?? categoryInvite}</div>}>
                    {({ selectRemountKey }) => (
                      <Select key={selectRemountKey} value={selectedCategory} onValueChange={(value) => { setSelectedCategory(value); setCategoryError(""); }}>
                        <SelectTrigger className={cn("h-11 w-full", DIALOG_FORM_FIELD_ROSE)}><SelectValue placeholder={categoryInvite} /></SelectTrigger>
                        <SelectContent className={cn(DIALOG_SELECT_CONTENT_CLASS, "z-[100]")} position="popper" sideOffset={5} align="start">
                          {activeCategories.length === 0 ? <SelectEmptyContent entity="category" /> : activeCategories.map((category) => <SelectItem key={category.id} value={category.id} className={DIALOG_SELECT_ITEM_CLASS}>{category.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </DeferredSelectGate>
                  {categoryError && <p className="text-xs text-red-400 mt-1">{categoryError}</p>}
                </div>
                <div className="mt-5 flex flex-col gap-2">
                  <DialogFormLabel icon={Truck} required>Proveedor</DialogFormLabel>
                  <DeferredSelectGate enabled={openProductDialog} placeholder={<div className={cn("flex h-11 w-full items-center rounded-md px-2 text-sm text-white/60", DIALOG_FORM_FIELD_ROSE)} aria-hidden>{selectedSupplier ? <AvatarInlineLink label={activeSuppliers.find((s) => s.id === selectedSupplier)?.name ?? supplierInvite} seed={activeSuppliers.find((s) => s.id === selectedSupplier)?.userId ?? selectedSupplier} size={22} linkClassName="text-sm font-normal text-white/90" /> : supplierInvite}</div>}>
                    {({ selectRemountKey }) => (
                      <Select key={selectRemountKey} value={selectedSupplier} onValueChange={(value) => { setSelectedSupplier(value); setSupplierError(""); }}>
                        <SelectTrigger className={cn("h-11 w-full [&>span]:line-clamp-none", DIALOG_FORM_FIELD_ROSE)}>
                          <SelectValue placeholder={supplierInvite}>{selectedSupplier ? <AvatarInlineLink label={activeSuppliers.find((s) => s.id === selectedSupplier)?.name ?? supplierInvite} seed={activeSuppliers.find((s) => s.id === selectedSupplier)?.userId ?? selectedSupplier} size={22} linkClassName="text-sm font-normal text-white/90" /> : supplierInvite}</SelectValue>
                        </SelectTrigger>
                        <SelectContent className={cn(DIALOG_SELECT_CONTENT_CLASS, "z-[100]")} position="popper" sideOffset={5} align="start">
                          {activeSuppliers.length === 0 ? <SelectEmptyContent entity="supplier" /> : activeSuppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id} className={DIALOG_SELECT_ITEM_CLASS}><AvatarInlineLink label={supplier.name} seed={supplier.userId ?? supplier.id} size={22} linkClassName="text-sm font-normal text-popover-foreground" /></SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </DeferredSelectGate>
                  {supplierError && <p className="text-xs text-red-400 mt-1">{supplierError}</p>}
                </div>

                {!selectedProduct ? (
                  <div className="mt-5 flex flex-col gap-2 sm:col-span-2">
                    <DialogFormLabel icon={WarehouseIcon} required={watchedQuantity > 0}>Bodega inicial{watchedQuantity <= 0 ? " (opcional sin stock)" : ""}</DialogFormLabel>
                    <DeferredSelectGate enabled={openProductDialog} placeholder={<div className={cn("flex h-11 w-full items-center rounded-md px-2 text-sm text-white/60", DIALOG_FORM_FIELD_ROSE)} aria-hidden>{activeWarehouses.find((w) => w.id === selectedWarehouse)?.name ?? warehouseInvite}</div>}>
                      {({ selectRemountKey }) => (
                        <Select key={selectRemountKey} value={selectedWarehouse} onValueChange={(value) => { setSelectedWarehouse(value); setWarehouseError(""); }}>
                          <SelectTrigger className={cn("h-11 w-full", DIALOG_FORM_FIELD_ROSE)}><SelectValue placeholder={warehouseInvite} /></SelectTrigger>
                          <SelectContent className={cn(DIALOG_SELECT_CONTENT_CLASS, "z-[100]")} position="popper" sideOffset={5} align="start">
                            {activeWarehouses.length === 0 ? <SelectEmptyContent entity="warehouse" /> : activeWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id} className={DIALOG_SELECT_ITEM_CLASS}>{warehouse.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </DeferredSelectGate>
                    <p className={DIALOG_FORM_HINT_TEXT}>{watchedQuantity > 0 ? "Las unidades iniciales se registrarán automáticamente en esta bodega." : "Puedes crear el producto sin stock y asignar una bodega después."}</p>
                    {warehouseError && <p className={DIALOG_FORM_ERROR_TEXT} role="alert">{warehouseError}</p>}
                  </div>
                ) : (
                  <div className="mt-5 flex flex-col gap-2 sm:col-span-2">
                    <DialogFormLabel icon={WarehouseIcon}>Ubicación actual</DialogFormLabel>
                    <div className={cn("min-h-11 w-full rounded-md px-3 py-2", DIALOG_FORM_FIELD_ROSE)}>
                      {productAllocations.length > 0 ? (
                        <div className="flex flex-wrap gap-2">{productAllocations.map((allocation) => <span key={allocation.id} className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1.5 text-sm text-white/90"><WarehouseIcon className="h-3.5 w-3.5 text-rose-300" />{allocation.warehouse?.name ?? "Bodega"}: {Number(allocation.quantity ?? 0)}</span>)}</div>
                      ) : <span className="text-sm text-white/55">Sin bodega asignada</span>}
                    </div>
                    <p className={DIALOG_FORM_HINT_TEXT}>Para mover existencias entre bodegas utiliza la sección Movimientos.</p>

                    <div className="mt-2 flex flex-col gap-2">
                      <DialogFormLabel icon={WarehouseIcon} required={additionalUnitsToAllocate > 0}>Bodega para nuevas existencias{additionalUnitsToAllocate > 0 ? " *" : ""}</DialogFormLabel>
                      <DeferredSelectGate enabled={openProductDialog} placeholder={<div className={cn("flex h-11 w-full items-center rounded-md px-2 text-sm text-white/60", DIALOG_FORM_FIELD_ROSE)} aria-hidden>{activeWarehouses.find((w) => w.id === selectedWarehouse)?.name ?? warehouseInvite}</div>}>
                        {({ selectRemountKey }) => (
                          <Select key={selectRemountKey} value={selectedWarehouse} onValueChange={(value) => { setSelectedWarehouse(value); setWarehouseError(""); }}>
                            <SelectTrigger className={cn("h-11 w-full", DIALOG_FORM_FIELD_ROSE)}><SelectValue placeholder={warehouseInvite} /></SelectTrigger>
                            <SelectContent className={cn(DIALOG_SELECT_CONTENT_CLASS, "z-[100]")} position="popper" sideOffset={5} align="start">
                              {activeWarehouses.length === 0 ? <SelectEmptyContent entity="warehouse" /> : activeWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id} className={DIALOG_SELECT_ITEM_CLASS}>{warehouse.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                      </DeferredSelectGate>
                      <p className={DIALOG_FORM_HINT_TEXT}>
                        {additionalUnitsToAllocate > 0
                          ? `Las ${additionalUnitsToAllocate} nuevas unidad(es) se agregarán a la bodega seleccionada.`
                          : "Si aumentas la cantidad del producto, aquí indicarás dónde quedarán las nuevas unidades."}
                      </p>
                      {warehouseError && <p className={DIALOG_FORM_ERROR_TEXT} role="alert">{warehouseError}</p>}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter className="mt-9 mb-4 flex flex-col sm:flex-row items-center gap-2">
                <DialogClose asChild>
                  <Button ref={dialogCloseRef} variant="secondary" className={cn("h-11 w-full sm:w-auto px-11 gap-2", GLASS_GHOST_BUTTON)}><X className="h-4 w-4 shrink-0" aria-hidden />Cancelar</Button>
                </DialogClose>
                <DialogSubmitButton isPending={isSubmitting} pendingLabel={selectedProduct ? "Actualizando producto…" : "Agregando producto…"} label={selectedProduct ? "Actualizar producto" : "Agregar producto"} icon={PackagePlus} hue="rose" disabled={!canSubmitUpdate} className="h-11 px-11" />
              </DialogFooter>
            </div>
          </form>
        </FormProvider>
      </DialogContent>
      <AlertDialogWrapper
        open={shrinkConfirmOpen}
        onOpenChange={setShrinkConfirmOpen}
        title="¿Reducir las asignaciones del almacén?"
        description={`Reducir la cantidad del inventario eliminará ${pendingShrinkUnits} unidad(es) no reservada(s) de las asignaciones del almacén. El stock reservado no se verá afectado.`}
        actionLabel="Actualizar producto"
        actionLoadingLabel="Actualizando…"
        isLoading={updateProductMutation.isPending}
        onAction={async () => { if (!pendingUpdatePayload) return; await submitProductUpdate(pendingUpdatePayload); }}
        onCancel={() => { setShrinkConfirmOpen(false); setPendingUpdatePayload(null); setPendingShrinkUnits(0); }}
        actionVariant="destructive"
      />
    </Dialog>
  );
}
