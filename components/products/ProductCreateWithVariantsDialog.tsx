"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCategories, useSuppliers, useWarehouses } from "@/hooks/queries";
import { Package, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = { name: string; sku: string; purchasePrice: string; price: string; quantity: string; warehouseId: string; attributeLabel: string; attributeValue: string };
const newVariant = (): Variant => ({ name: "", sku: "", purchasePrice: "", price: "", quantity: "0", warehouseId: "", attributeLabel: "", attributeValue: "" });

export default function ProductCreateWithVariantsDialog({ children, onOpenChange }: { children?: React.ReactNode; onOpenChange?: (open: boolean) => void }) {
  const { data: categories = [] } = useCategories();
  const { data: suppliers = [] } = useSuppliers();
  const { data: warehouses = [] } = useWarehouses();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(""); const [sku, setSku] = useState(""); const [categoryId, setCategoryId] = useState(""); const [supplierId, setSupplierId] = useState("");
  const [hasVariants, setHasVariants] = useState(false); const [variants, setVariants] = useState<Variant[]>([]); const [quantity, setQuantity] = useState("0"); const [warehouseId, setWarehouseId] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("0"); const [price, setPrice] = useState("0"); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const totalVariantStock = variants.reduce((n, v) => n + Math.max(0, Number(v.quantity) || 0), 0);
  const setDialog = (value: boolean) => { setOpen(value); onOpenChange?.(value); if (!value) { setError(""); setVariants([]); setHasVariants(false); } };
  const updateVariant = (i: number, patch: Partial<Variant>) => setVariants(vs => vs.map((v, j) => j === i ? { ...v, ...patch } : v));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (!name.trim() || !sku.trim() || !categoryId || !supplierId) { setError("Completa nombre, SKU, categoría y proveedor."); return; }
    if (hasVariants && (!variants.length || variants.some(v => !v.name.trim() || !v.sku.trim()))) { setError("Cada variante necesita nombre y SKU."); return; }
    if (hasVariants && variants.some(v => Number(v.quantity) > 0 && !v.warehouseId)) { setError("Selecciona una bodega para cada variante que tenga stock."); return; }
    if (!hasVariants && Number(quantity) > 0 && !warehouseId) { setError("Selecciona la bodega para el stock inicial."); return; }
    setSaving(true);
    try {
      const total = hasVariants ? totalVariantStock : Math.max(0, Number(quantity) || 0);
      const productResponse = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), sku: sku.trim(), categoryId, supplierId, quantity: total, purchasePrice: Number(purchasePrice) || 0, price: Number(price) || 0, status: total > 0 ? "available" : "stock_out" }) });
      const product = await productResponse.json();
      if (!productResponse.ok) throw new Error(product.error || "No se pudo crear el producto");
      if (hasVariants) {
        for (const v of variants) {
          const variantResponse = await fetch(`/api/products/${product.id}/variants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: v.name.trim(), sku: v.sku.trim(), purchasePrice: Number(v.purchasePrice) || 0, price: Number(v.price) || 0, attributes: v.attributeLabel.trim() && v.attributeValue.trim() ? { [v.attributeLabel.trim()]: v.attributeValue.trim() } : null, quantity: Math.max(0, Number(v.quantity) || 0), warehouseId: v.warehouseId || null }) });
          const variant = await variantResponse.json();
          if (!variantResponse.ok) throw new Error(variant.error || `No se pudo crear la variante ${v.name}`);
        }
      } else if (Number(quantity) > 0) {
        const stockResponse = await fetch("/api/stock-allocations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: product.id, warehouseId, quantity: Number(quantity) }) });
        if (!stockResponse.ok) { const stock = await stockResponse.json().catch(() => ({})); throw new Error(stock.error || "No se pudo asignar el stock inicial"); }
      }
      window.location.reload();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo crear el producto."); } finally { setSaving(false); }
  }

  return <Dialog open={open} onOpenChange={setDialog}>
    <DialogTrigger asChild>{children || <Button><Package className="mr-2 h-4 w-4" />Agregar producto</Button>}</DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto max-w-3xl poppins">
      <div className="border-b border-white/10 pb-3"><h2 className="flex items-center gap-2 text-lg font-semibold"><Package className="h-5 w-5" />Agregar producto</h2><p className="text-sm text-muted-foreground">Crea el producto y sus variantes desde el mismo formulario.</p></div>
      <form onSubmit={submit} className="space-y-4 py-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del producto" /><Input value={sku} onChange={e => setSku(e.target.value)} placeholder="SKU del producto" /><Select value={categoryId} onValueChange={setCategoryId}><SelectTrigger><SelectValue placeholder="Categoría" /></SelectTrigger><SelectContent>{categories.filter(c => c.status !== false).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select><Select value={supplierId} onValueChange={setSupplierId}><SelectTrigger><SelectValue placeholder="Proveedor" /></SelectTrigger><SelectContent>{suppliers.filter(s => s.status !== false).map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3"><div><p className="font-medium">¿Tiene variantes?</p><p className="text-xs text-muted-foreground">Ej.: Dorada, Negra, Natural o Premium, Original.</p></div><Button type="button" variant={hasVariants ? "default" : "secondary"} onClick={() => { setHasVariants(v => !v); setVariants(v => v.length ? v : [newVariant()]); }}>{hasVariants ? "Sí, usar variantes" : "Producto simple"}</Button></div>
        {hasVariants ? <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">Variantes</h3><Button type="button" size="sm" onClick={() => setVariants(v => [...v, newVariant()])}><Plus className="mr-1 h-4 w-4" />Agregar variante</Button></div>{variants.map((v, i) => <div key={i} className="rounded-xl border border-white/10 p-3 space-y-2"><div className="flex items-center justify-between"><span className="text-sm font-medium">Variante {i + 1}</span><Button type="button" variant="ghost" size="icon" onClick={() => setVariants(vs => vs.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Input value={v.name} onChange={e => updateVariant(i,{name:e.target.value})} placeholder="Nombre (ej. Dorada)" /><Input value={v.sku} onChange={e => updateVariant(i,{sku:e.target.value})} placeholder="SKU de variante" /><Input value={v.attributeLabel} onChange={e => updateVariant(i,{attributeLabel:e.target.value})} placeholder="Atributo (Color / Calidad)" /><Input value={v.attributeValue} onChange={e => updateVariant(i,{attributeValue:e.target.value})} placeholder="Valor" /><Input type="number" min="0" value={v.purchasePrice} onChange={e => updateVariant(i,{purchasePrice:e.target.value})} placeholder="Costo" /><Input type="number" min="0" value={v.price} onChange={e => updateVariant(i,{price:e.target.value})} placeholder="Precio de venta" /><Input type="number" min="0" value={v.quantity} onChange={e => updateVariant(i,{quantity:e.target.value})} placeholder="Stock inicial" /><Select value={v.warehouseId} onValueChange={value => updateVariant(i,{warehouseId:value})}><SelectTrigger><SelectValue placeholder="Bodega" /></SelectTrigger><SelectContent>{warehouses.filter(w => w.status !== false).map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div></div>)}<p className="text-sm text-muted-foreground">Stock total del producto: <strong>{totalVariantStock}</strong></p></div> : <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Input type="number" min="0" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="Costo" /><Input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="Precio de venta" /><Input type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="Stock inicial" /><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger className="sm:col-span-3"><SelectValue placeholder="Bodega inicial" /></SelectTrigger><SelectContent>{warehouses.filter(w => w.status !== false).map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>}
        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="secondary" onClick={() => setDialog(false)}><X className="mr-1 h-4 w-4" />Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Creando…" : "Crear producto"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
