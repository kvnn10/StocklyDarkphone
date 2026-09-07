"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductThumb } from "./ProductOptionRow";

type VariantStock = { id: string; warehouseId: string; quantity: number; reservedQuantity: number };
type Variant = { id: string; name: string; sku: string; price: number; purchasePrice: number; quantity: number; reservedQuantity: number; status: string; attributes?: Record<string, unknown> | null; stocks: VariantStock[] };

type Props = { product: { id: string; name: string; sku: string; imageUrl?: string | null; price?: number; purchasePrice?: number }; open: boolean; onOpenChange: (open: boolean) => void };

const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value || 0);

export default function ProductVariantsDialog({ product, open, onOpenChange }: Props) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [attribute, setAttribute] = useState("Color");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [price, setPrice] = useState("");

  const load = async () => {
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/products/${product.id}/variants`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar las variantes");
      setVariants(Array.isArray(data) ? data : []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudieron cargar las variantes"); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) { load(); setName(""); setSku(""); setPurchasePrice(String(product.purchasePrice ?? "")); setPrice(String(product.price ?? "")); setAttribute("Color"); } }, [open, product.id]);

  const suggestedSku = useMemo(() => {
    const base = product.sku.trim(); const value = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
    return value ? `${base}-${value}` : base;
  }, [product.sku, name]);

  const createVariant = async () => {
    const cleanName = name.trim();
    if (!cleanName) return setMessage("Escribe el valor de la variante, por ejemplo Dorada o Premium.");
    const finalSku = (sku.trim() || suggestedSku).slice(0, 120);
    if (!finalSku) return setMessage("La variante necesita un SKU.");
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/products/${product.id}/variants`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: cleanName, sku: finalSku, purchasePrice: Math.max(0, Number(purchasePrice) || 0), price: Math.max(0, Number(price) || 0), attributes: { [attribute.trim() || "Atributo"]: cleanName } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear la variante");
      setVariants(current => [...current, data]); setName(""); setSku(""); setMessage(`Variante ${cleanName} creada.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo crear la variante"); }
    finally { setSaving(false); }
  };

  const deleteVariant = async (variant: Variant) => {
    if (!window.confirm(`¿Eliminar la variante "${variant.name}"?`)) return;
    setMessage("");
    try {
      const response = await fetch(`/api/products/${product.id}/variants/${variant.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar la variante");
      setVariants(current => current.filter(item => item.id !== variant.id));
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo eliminar la variante"); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[90vh] overflow-hidden p-0">
      <DialogHeader className="border-b px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <ProductThumb name={product.name} imageUrl={product.imageUrl} size="md" />
          <div className="min-w-0"><DialogTitle className="truncate">Variantes de {product.name}</DialogTitle><p className="truncate text-xs text-muted-foreground">Producto base · {product.sku}</p></div>
        </div>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
          <div className="flex items-center gap-2"><Plus className="h-4 w-4" /><h3 className="font-medium">Agregar variante</h3></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm"><span>Atributo</span><Input value={attribute} onChange={e => setAttribute(e.target.value)} placeholder="Color, Calidad, Tipo..." /></label>
            <label className="space-y-1 text-sm"><span>Valor / variante</span><Input value={name} onChange={e => setName(e.target.value)} placeholder="Dorada, Negra, Premium..." /></label>
            <label className="space-y-1 text-sm"><span>SKU</span><Input value={sku} onChange={e => setSku(e.target.value)} placeholder={suggestedSku} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-sm"><span>Costo</span><Input type="number" min="0" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} /></label>
              <label className="space-y-1 text-sm"><span>Venta</span><Input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} /></label>
            </div>
          </div>
          <div className="flex justify-end"><Button onClick={createVariant} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Crear variante</Button></div>
        </div>
        {message && <div className="mt-3 rounded-lg border bg-background px-3 py-2 text-sm">{message}</div>}
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between"><h3 className="font-medium">Variantes existentes</h3><span className="text-xs text-muted-foreground">{variants.length} variante{variants.length === 1 ? "" : "s"}</span></div>
          {loading ? <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando...</div> : variants.length === 0 ? <div className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">Este producto todavía no tiene variantes.</div> : <div className="space-y-2">{variants.map(variant => <div key={variant.id} className="flex min-w-0 items-center gap-3 rounded-xl border p-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{variant.name}</span><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px]">{variant.sku}</span></div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{money(variant.purchasePrice)} costo</span><span>{money(variant.price)} venta</span><span className="inline-flex items-center gap-1"><Boxes className="h-3 w-3" />{variant.quantity} stock</span>{variant.attributes && Object.entries(variant.attributes).map(([key, value]) => <span key={key}>{key}: {String(value)}</span>)}</div></div><Button variant="ghost" size="icon" onClick={() => deleteVariant(variant)} disabled={variant.quantity > 0 || variant.reservedQuantity > 0} title={variant.quantity > 0 ? "No se puede eliminar con stock" : "Eliminar variante"}><Trash2 className="h-4 w-4" /></Button></div>)}</div>}
        </div>
      </div>
      <div className="flex justify-end border-t px-4 py-3 sm:px-6"><Button variant="outline" onClick={() => onOpenChange(false)}><X className="h-4 w-4" />Cerrar</Button></div>
    </DialogContent>
  </Dialog>;
}
