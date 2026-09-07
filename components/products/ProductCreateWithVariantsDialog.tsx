"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCategories, useSuppliers, useWarehouses } from "@/hooks/queries";
import { Package, Plus, Trash2, X } from "lucide-react";

type Variant = {
  name: string;
  sku: string;
  purchasePrice: string;
  price: string;
  quantity: string;
  warehouseId: string;
};

const newVariant = (): Variant => ({
  name: "",
  sku: "",
  purchasePrice: "",
  price: "",
  quantity: "0",
  warehouseId: "",
});

export default function ProductCreateWithVariantsDialog({
  children,
  onOpenChange,
}: {
  children?: ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const { data: categories = [] } = useCategories();
  const { data: suppliers = [] } = useSuppliers();
  const { data: warehouses = [] } = useWarehouses();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [hasVariants, setHasVariants] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [quantity, setQuantity] = useState("0");
  const [warehouseId, setWarehouseId] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("0");
  const [price, setPrice] = useState("0");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const totalVariantStock = variants.reduce(
    (total, variant) => total + Math.max(0, Number(variant.quantity) || 0),
    0,
  );

  const setDialog = (value: boolean) => {
    setOpen(value);
    onOpenChange?.(value);
    if (!value) {
      setError("");
      setVariants([]);
      setHasVariants(false);
    }
  };

  const updateVariant = (index: number, patch: Partial<Variant>) => {
    setVariants((current) =>
      current.map((variant, itemIndex) =>
        itemIndex === index ? { ...variant, ...patch } : variant,
      ),
    );
  };

  const enableVariants = () => {
    setHasVariants(true);
    setVariants((current) => (current.length ? current : [newVariant()]));
  };

  const disableVariants = () => {
    setHasVariants(false);
    setVariants([]);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (!name.trim() || !sku.trim() || !categoryId || !supplierId) {
      setError("Completa nombre, SKU, categoría y proveedor.");
      return;
    }

    if (
      hasVariants &&
      (!variants.length || variants.some((variant) => !variant.name.trim() || !variant.sku.trim()))
    ) {
      setError("Cada variante necesita nombre y SKU.");
      return;
    }

    if (
      hasVariants &&
      variants.some((variant) => Number(variant.quantity) > 0 && !variant.warehouseId)
    ) {
      setError("Selecciona una bodega para cada variante que tenga stock.");
      return;
    }

    if (!hasVariants && Number(quantity) > 0 && !warehouseId) {
      setError("Selecciona la bodega para el stock inicial.");
      return;
    }

    setSaving(true);

    try {
      const total = hasVariants
        ? totalVariantStock
        : Math.max(0, Number(quantity) || 0);

      const productResponse = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sku: sku.trim(),
          categoryId,
          supplierId,
          quantity: total,
          purchasePrice: Number(purchasePrice) || 0,
          price: Number(price) || 0,
          status: total > 0 ? "available" : "stock_out",
        }),
      });

      const product = await productResponse.json();
      if (!productResponse.ok) {
        throw new Error(product.error || "No se pudo crear el producto");
      }

      if (hasVariants) {
        for (const variant of variants) {
          const variantResponse = await fetch(
            `/api/products/${product.id}/variants`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: variant.name.trim(),
                sku: variant.sku.trim(),
                purchasePrice: Number(variant.purchasePrice) || 0,
                price: Number(variant.price) || 0,
                attributes: null,
                initialQuantity: Math.max(0, Number(variant.quantity) || 0),
                warehouseId: variant.warehouseId || null,
              }),
            },
          );

          const createdVariant = await variantResponse.json();
          if (!variantResponse.ok) {
            throw new Error(
              createdVariant.error || `No se pudo crear la variante ${variant.name}`,
            );
          }
        }
      } else if (Number(quantity) > 0) {
        const stockResponse = await fetch("/api/stock-allocations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: product.id,
            warehouseId,
            quantity: Number(quantity),
          }),
        });

        if (!stockResponse.ok) {
          const stock = await stockResponse.json().catch(() => ({}));
          throw new Error(stock.error || "No se pudo asignar el stock inicial");
        }
      }

      window.location.reload();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "No se pudo crear el producto.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setDialog}>
      <DialogTrigger asChild>
        {children || (
          <Button>
            <Package className="mr-2 h-4 w-4" />
            Agregar producto
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto poppins">
        <div className="border-b border-white/10 pb-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Package className="h-5 w-5" />
            Agregar producto
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Primero crea el producto. Si tiene opciones como color o calidad,
            agrégalas como variantes aquí mismo.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-5 py-2">
          <section className="space-y-3">
            <div>
              <h3 className="font-semibold">1. Datos del producto</h3>
              <p className="text-xs text-muted-foreground">
                Estos datos pertenecen al producto principal.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span>Nombre del producto</span>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ej. Tapa iPhone 16 Pro Max"
                />
              </label>

              <label className="space-y-1.5 text-sm">
                <span>SKU del producto</span>
                <Input
                  value={sku}
                  onChange={(event) => setSku(event.target.value)}
                  placeholder="Ej. TAPA-16PM"
                />
              </label>

              <label className="space-y-1.5 text-sm">
                <span>Categoría</span>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona una categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories
                      .filter((category) => category.status !== false)
                      .map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="space-y-1.5 text-sm">
                <span>Proveedor</span>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un proveedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers
                      .filter((supplier) => supplier.status !== false)
                      .map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold">2. ¿Este producto tiene variantes?</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ejemplo: Tapa iPhone 16 Pro Max → Dorada, Negra, Natural y Blanca.
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={!hasVariants ? "default" : "secondary"}
                  onClick={disableVariants}
                >
                  No, producto simple
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={hasVariants ? "default" : "secondary"}
                  onClick={enableVariants}
                >
                  Sí, agregar variantes
                </Button>
              </div>
            </div>
          </section>

          {hasVariants ? (
            <section className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="font-semibold">3. Variantes del producto</h3>
                  <p className="text-xs text-muted-foreground">
                    Cada variante tendrá su propio SKU, precio y stock.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setVariants((current) => [...current, newVariant()])}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Agregar variante
                </Button>
              </div>

              <div className="space-y-3">
                {variants.map((variant, index) => (
                  <div
                    key={index}
                    className="rounded-xl border border-white/10 bg-white/[0.025] p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">Variante {index + 1}</p>
                        <p className="text-xs text-muted-foreground">
                          Ej.: Dorada, Negra, Premium u Original
                        </p>
                      </div>
                      {variants.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setVariants((current) =>
                              current.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                          aria-label={`Eliminar variante ${index + 1}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="space-y-1.5 text-sm lg:col-span-2">
                        <span>Nombre de la variante</span>
                        <Input
                          value={variant.name}
                          onChange={(event) =>
                            updateVariant(index, { name: event.target.value })
                          }
                          placeholder="Ej. Dorada"
                        />
                      </label>

                      <label className="space-y-1.5 text-sm">
                        <span>SKU de la variante</span>
                        <Input
                          value={variant.sku}
                          onChange={(event) =>
                            updateVariant(index, { sku: event.target.value })
                          }
                          placeholder="Ej. TAPA-16PM-DOR"
                        />
                      </label>

                      <label className="space-y-1.5 text-sm">
                        <span>Costo de compra</span>
                        <Input
                          type="number"
                          min="0"
                          value={variant.purchasePrice}
                          onChange={(event) =>
                            updateVariant(index, { purchasePrice: event.target.value })
                          }
                          placeholder="0"
                        />
                      </label>

                      <label className="space-y-1.5 text-sm">
                        <span>Precio de venta</span>
                        <Input
                          type="number"
                          min="0"
                          value={variant.price}
                          onChange={(event) =>
                            updateVariant(index, { price: event.target.value })
                          }
                          placeholder="0"
                        />
                      </label>

                      <label className="space-y-1.5 text-sm">
                        <span>Stock inicial</span>
                        <Input
                          type="number"
                          min="0"
                          value={variant.quantity}
                          onChange={(event) =>
                            updateVariant(index, { quantity: event.target.value })
                          }
                          placeholder="0"
                        />
                      </label>

                      <label className="space-y-1.5 text-sm sm:col-span-2 lg:col-span-3">
                        <span>Bodega del stock inicial</span>
                        <Select
                          value={variant.warehouseId}
                          onValueChange={(value) =>
                            updateVariant(index, { warehouseId: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona una bodega" />
                          </SelectTrigger>
                          <SelectContent>
                            {warehouses
                              .filter((warehouse) => warehouse.status !== false)
                              .map((warehouse) => (
                                <SelectItem key={warehouse.id} value={warehouse.id}>
                                  {warehouse.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
                Stock total del producto: <strong>{totalVariantStock}</strong> unidades
              </div>
            </section>
          ) : (
            <section className="space-y-3">
              <div>
                <h3 className="font-semibold">3. Inventario</h3>
                <p className="text-xs text-muted-foreground">
                  Al ser un producto simple, el stock pertenece directamente al producto.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="space-y-1.5 text-sm">
                  <span>Costo de compra</span>
                  <Input
                    type="number"
                    min="0"
                    value={purchasePrice}
                    onChange={(event) => setPurchasePrice(event.target.value)}
                    placeholder="0"
                  />
                </label>

                <label className="space-y-1.5 text-sm">
                  <span>Precio de venta</span>
                  <Input
                    type="number"
                    min="0"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="0"
                  />
                </label>

                <label className="space-y-1.5 text-sm">
                  <span>Stock inicial</span>
                  <Input
                    type="number"
                    min="0"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    placeholder="0"
                  />
                </label>

                <label className="space-y-1.5 text-sm sm:col-span-3">
                  <span>Bodega del stock inicial</span>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona una bodega" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses
                        .filter((warehouse) => warehouse.status !== false)
                        .map((warehouse) => (
                          <SelectItem key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
            </section>
          )}

          {error && (
            <p
              className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
              role="alert"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDialog(false)}>
              <X className="mr-1 h-4 w-4" />
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creando…" : "Crear producto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
