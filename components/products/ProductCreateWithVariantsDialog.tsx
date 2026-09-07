"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCategories, useSuppliers, useWarehouses } from "@/hooks/queries";
import { Image as ImageIcon, Loader2, Package, Plus, Trash2, Upload, X } from "lucide-react";

type Variant = { name: string; sku: string; purchasePrice: string; price: string; quantity: string; warehouseId: string };
const newVariant = (): Variant => ({ name: "", sku: "", purchasePrice: "", price: "", quantity: "0", warehouseId: "" });
const MEDIA_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"];

export default function ProductCreateWithVariantsDialog({ children, onOpenChange }: { children?: ReactNode; onOpenChange?: (open: boolean) => void }) {
  const { data: categories = [] } = useCategories();
  const { data: suppliers = [] } = useSuppliers();
  const { data: warehouses = [] } = useWarehouses();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [sku, setSku] = useState(""), [categoryId, setCategoryId] = useState(""), [supplierId, setSupplierId] = useState(""), [hasVariants, setHasVariants] = useState(false), [variants, setVariants] = useState<Variant[]>([]), [quantity, setQuantity] = useState("0"), [warehouseId, setWarehouseId] = useState(""), [purchasePrice, setPurchasePrice] = useState("0"), [price, setPrice] = useState("0"), [mediaUrl, setMediaUrl] = useState(""), [mediaFileId, setMediaFileId] = useState(""), [mediaType, setMediaType] = useState<"image" | "video" | "">(""), [uploadingMedia, setUploadingMedia] = useState(false), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const totalVariantStock = variants.reduce((total, variant) => total + Math.max(0, Number(variant.quantity) || 0), 0);
  const setDialog = (value: boolean) => { setOpen(value); onOpenChange?.(value); if (!value) { setError(""); setVariants([]); setHasVariants(false); setMediaUrl(""); setMediaFileId(""); setMediaType(""); } };
  const updateVariant = (index: number, patch: Partial<Variant>) => setVariants((current) => current.map((variant, i) => i === index ? { ...variant, ...patch } : variant));
  const enableVariants = () => { setHasVariants(true); setVariants((current) => current.length ? current : [newVariant()]); };
  const disableVariants = () => { setHasVariants(false); setVariants([]); };

  const uploadMedia = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!MEDIA_TYPES.includes(file.type)) { setError("Usa una imagen JPEG, PNG, WebP o un video MP4, WebM o MOV."); return; }
    if (file.size > 4 * 1024 * 1024) { setError("La imagen o video debe pesar menos de 4 MB."); return; }
    setUploadingMedia(true); setError("");
    try {
      const formData = new FormData(); formData.append("file", file); if (sku.trim()) formData.append("sku", sku.trim());
      const response = await fetch("/api/products/image", { method: "POST", body: formData, credentials: "include" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || data.message || "No se pudo subir el archivo");
      setMediaUrl(data.imageUrl || ""); setMediaFileId(data.imageFileId || ""); setMediaType(data.mediaType || (file.type.startsWith("video/") ? "video" : "image"));
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo subir el archivo"); } finally { setUploadingMedia(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const removeMedia = async () => { if (mediaFileId) await fetch(`/api/products/image?fileId=${encodeURIComponent(mediaFileId)}`, { method: "DELETE", credentials: "include" }).catch(() => {}); setMediaUrl(""); setMediaFileId(""); setMediaType(""); };

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!name.trim() || !sku.trim() || !categoryId || !supplierId) { setError("Completa nombre, SKU, categoría y proveedor."); return; }
    if (hasVariants && (!variants.length || variants.some((v) => !v.name.trim() || !v.sku.trim()))) { setError("Cada variante necesita nombre y SKU."); return; }
    if (hasVariants && variants.some((v) => Number(v.quantity) > 0 && !v.warehouseId)) { setError("Selecciona una bodega para cada variante que tenga stock."); return; }
    if (!hasVariants && Number(quantity) > 0 && !warehouseId) { setError("Selecciona la bodega para el stock inicial."); return; }
    setSaving(true);
    try {
      const total = hasVariants ? totalVariantStock : Math.max(0, Number(quantity) || 0);
      const response = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), sku: sku.trim(), categoryId, supplierId, quantity: total, purchasePrice: Number(purchasePrice) || 0, price: Number(price) || 0, status: total > 0 ? "available" : "stock_out", imageUrl: mediaUrl || null, imageFileId: mediaFileId || null }) });
      const product = await response.json(); if (!response.ok) throw new Error(product.error || "No se pudo crear el producto");
      if (hasVariants) {
        for (const variant of variants) {
          const variantResponse = await fetch(`/api/products/${product.id}/variants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: variant.name.trim(), sku: variant.sku.trim(), purchasePrice: Number(variant.purchasePrice) || 0, price: Number(variant.price) || 0, attributes: null, initialQuantity: Math.max(0, Number(variant.quantity) || 0), warehouseId: variant.warehouseId || null }) });
          const createdVariant = await variantResponse.json(); if (!variantResponse.ok) throw new Error(createdVariant.error || `No se pudo crear la variante ${variant.name}`);
        }
      } else if (Number(quantity) > 0) {
        const stockResponse = await fetch("/api/stock-allocations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: product.id, warehouseId, quantity: Number(quantity) }) });
        if (!stockResponse.ok) { const stock = await stockResponse.json().catch(() => ({})); throw new Error(stock.error || "No se pudo asignar el stock inicial"); }
      }
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear el producto."); } finally { setSaving(false); }
  }

  return <Dialog open={open} onOpenChange={setDialog}>
    <DialogTrigger asChild>{children || <Button><Package className="mr-2 h-4 w-4" />Agregar producto</Button>}</DialogTrigger>
    <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto poppins">
      <div className="border-b border-white/10 pb-4"><h2 className="flex items-center gap-2 text-lg font-semibold"><Package className="h-5 w-5" />Agregar producto</h2><p className="mt-1 text-sm text-muted-foreground">Crea el producto y, si aplica, sus variantes con stock independiente.</p></div>
      <form onSubmit={submit} className="space-y-5 py-2">
        <section className="space-y-3"><div><h3 className="font-semibold">1. Datos del producto</h3><p className="text-xs text-muted-foreground">Estos datos pertenecen al producto principal.</p></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm"><span>Nombre del producto</span><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Tapa iPhone 16 Pro Max" /></label>
            <label className="space-y-1.5 text-sm"><span>SKU del producto</span><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ej. TAPA-16PM" /></label>
            <label className="space-y-1.5 text-sm"><span>Categoría</span><Select value={categoryId} onValueChange={setCategoryId}><SelectTrigger><SelectValue placeholder="Selecciona una categoría" /></SelectTrigger><SelectContent>{categories.filter((c) => c.status !== false).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></label>
            <label className="space-y-1.5 text-sm"><span>Proveedor</span><Select value={supplierId} onValueChange={setSupplierId}><SelectTrigger><SelectValue placeholder="Selecciona un proveedor" /></SelectTrigger><SelectContent>{suppliers.filter((s) => s.status !== false).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></label>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold">2. Imagen o video</h3><p className="mt-1 text-xs text-muted-foreground">Agrega una foto del producto o un video corto. Máximo 4 MB.</p></div><input ref={fileRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={uploadMedia} className="hidden" /></div>
          {mediaUrl ? <div className="relative mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">{mediaType === "video" ? <video src={mediaUrl} controls playsInline className="h-48 w-full object-contain" /> : <img src={mediaUrl} alt="Vista previa" className="h-48 w-full object-contain" /> }<Button type="button" variant="destructive" size="icon" onClick={removeMedia} className="absolute right-2 top-2"><X className="h-4 w-4" /></Button></div> : <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploadingMedia} className="mt-3 w-full">{uploadingMedia ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Subiendo…</> : <><Upload className="mr-2 h-4 w-4" />Subir imagen o video</>}</Button>}
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold">3. ¿Este producto tiene variantes?</h3><p className="mt-1 text-xs text-muted-foreground">Ej.: colores, calidades o capacidades diferentes.</p></div><div className="flex gap-2"><Button type="button" size="sm" variant={!hasVariants ? "default" : "secondary"} onClick={disableVariants}>No, producto simple</Button><Button type="button" size="sm" variant={hasVariants ? "default" : "secondary"} onClick={enableVariants}>Sí, agregar variantes</Button></div></div></section>

        {hasVariants ? <section className="space-y-3"><div className="flex items-end justify-between gap-2"><div><h3 className="font-semibold">4. Variantes del producto</h3><p className="text-xs text-muted-foreground">Cada variante tendrá su propio SKU, precio y stock.</p></div><Button type="button" size="sm" variant="secondary" onClick={() => setVariants((current) => [...current, newVariant()])}><Plus className="mr-1 h-4 w-4" />Agregar variante</Button></div>
          {variants.map((variant, index) => <div key={index} className="rounded-xl border border-white/10 bg-white/[0.025] p-4"><div className="mb-3 flex items-center justify-between"><div><p className="font-semibold">Variante {index + 1}</p><p className="text-xs text-muted-foreground">Ej.: Dorada, Negra, Premium u Original</p></div>{variants.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setVariants((current) => current.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>}</div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="space-y-1.5 text-sm lg:col-span-2"><span>Nombre de la variante</span><Input value={variant.name} onChange={(e) => updateVariant(index, { name: e.target.value })} placeholder="Ej. Dorada" /></label><label className="space-y-1.5 text-sm"><span>SKU de la variante</span><Input value={variant.sku} onChange={(e) => updateVariant(index, { sku: e.target.value })} placeholder="Ej. TAPA-16PM-DOR" /></label><label className="space-y-1.5 text-sm"><span>Costo de compra</span><Input type="number" min="0" value={variant.purchasePrice} onChange={(e) => updateVariant(index, { purchasePrice: e.target.value })} /></label><label className="space-y-1.5 text-sm"><span>Precio de venta</span><Input type="number" min="0" value={variant.price} onChange={(e) => updateVariant(index, { price: e.target.value })} /></label><label className="space-y-1.5 text-sm"><span>Stock inicial</span><Input type="number" min="0" value={variant.quantity} onChange={(e) => updateVariant(index, { quantity: e.target.value })} /></label><label className="space-y-1.5 text-sm sm:col-span-2 lg:col-span-3"><span>Bodega del stock inicial</span><Select value={variant.warehouseId} onValueChange={(v) => updateVariant(index, { warehouseId: v })}><SelectTrigger><SelectValue placeholder="Selecciona una bodega" /></SelectTrigger><SelectContent>{warehouses.filter((w) => w.status !== false).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></label></div></div>)}
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">Stock total del producto: <strong>{totalVariantStock}</strong> unidades</div>
        </section> : <section className="space-y-3"><div><h3 className="font-semibold">4. Inventario</h3><p className="text-xs text-muted-foreground">Stock y precios del producto simple.</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><label className="space-y-1.5 text-sm"><span>Costo de compra</span><Input type="number" min="0" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} /></label><label className="space-y-1.5 text-sm"><span>Precio de venta</span><Input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} /></label><label className="space-y-1.5 text-sm"><span>Stock inicial</span><Input type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label></div><label className="block space-y-1.5 text-sm"><span>Bodega del stock inicial</span><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue placeholder="Selecciona una bodega" /></SelectTrigger><SelectContent>{warehouses.filter((w) => w.status !== false).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></label></section>}
        {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setDialog(false)}>Cancelar</Button><Button type="submit" disabled={saving || uploadingMedia}>{saving ? "Creando…" : "Crear producto"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
