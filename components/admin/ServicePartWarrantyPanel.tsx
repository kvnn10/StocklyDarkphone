"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Package, ShoppingCart, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Part = {
  id: string;
  productId: string;
  name: string;
  sku?: string;
  quantity: number;
  warrantyDays?: number;
  warrantyUntil?: string | null;
  external?: boolean;
  purchaseType?: string;
  unitCost?: number;
  unitPrice?: number;
  subtotal?: number;
  costSubtotal?: number;
  consumed?: boolean;
  warehouseName?: string;
};
type Option = { id: string; name: string; status?: boolean };

const money = (value: number) => `$${Number(value || 0).toLocaleString("es-CO")}`;

export default function ServicePartWarrantyPanel({ orderId }: { orderId: string }) {
  const [parts, setParts] = useState<Part[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [warrantyDays, setWarrantyDays] = useState("90");
  const [supplierName, setSupplierName] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [addToInventory, setAddToInventory] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const [partsResponse, categoriesResponse, suppliersResponse] = await Promise.all([
        fetch(`/api/service-orders/part-warranty?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" }),
        fetch("/api/categories", { cache: "no-store" }),
        fetch("/api/suppliers", { cache: "no-store" }),
      ]);
      const data = await partsResponse.json();
      if (!partsResponse.ok) throw new Error(data.error || "No se pudieron cargar las garantías de repuestos");
      setParts(data.parts || []);
      if (categoriesResponse.ok) setCategories((await categoriesResponse.json()).filter((item: Option) => item.status !== false));
      if (suppliersResponse.ok) setSuppliers((await suppliersResponse.json()).filter((item: Option) => item.status !== false));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar las garantías");
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [orderId]);

  const save = async (part: Part) => {
    setSavingId(part.id); setMessage("");
    try {
      const response = await fetch("/api/service-orders/part-warranty", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, partId: part.id, warrantyDays: Number(part.warrantyDays || 0) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar");
      setParts(data.parts || []); setMessage("Garantía del repuesto actualizada.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar"); }
    finally { setSavingId(""); }
  };

  const resetForm = () => {
    setName(""); setQuantity("1"); setPurchaseCost(""); setSalePrice(""); setWarrantyDays("90"); setSupplierName(""); setInvoiceRef(""); setAddToInventory(false); setCategoryId(""); setSupplierId("");
  };

  const createSpotPart = async () => {
    if (!name.trim() || !purchaseCost || !salePrice || !quantity) return;
    if (addToInventory && (!categoryId || !supplierId)) { setMessage("Para agregar al inventario selecciona categoría y proveedor."); return; }
    setCreating(true); setMessage("");
    try {
      const response = await fetch("/api/service-orders/external-part", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, name, quantity: Number(quantity), purchaseCost: Number(purchaseCost), salePrice: Number(salePrice), warrantyDays: Number(warrantyDays || 0), supplierName, invoiceRef, addToInventory, categoryId, supplierId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo agregar el repuesto");
      setMessage(addToInventory ? "Repuesto agregado y creado en inventario." : "Compra puntual agregada a la reparación. No afecta inventario.");
      resetForm(); setOpen(false); await load();
      window.setTimeout(() => window.location.reload(), 300);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo agregar el repuesto"); }
    finally { setCreating(false); }
  };

  return (
    <div className="space-y-6 px-2 pb-8 sm:px-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Garantía por repuesto</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">Cada producto puede tener su propia garantía predeterminada. Al agregar un repuesto, Stockly toma esa regla como base y la guarda en la orden.</p>
            </div>
            <Button type="button" onClick={() => setOpen(true)}><ShoppingCart className="mr-2 h-4 w-4" />Compra puntual / externo</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {parts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground"><Package className="mx-auto mb-2 h-5 w-5" />Agrega repuestos para configurar sus garantías.</div>
          ) : parts.map((part) => (
            <div key={part.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_140px_auto]">
              <div>
                <p className="font-medium">{part.name} · {part.sku || "Sin SKU"}</p>
                <p className="text-xs text-muted-foreground">Cantidad: {part.quantity}{part.external ? " · Compra puntual" : ""}{part.external && part.unitCost !== undefined ? ` · Costo ${money(part.unitCost * part.quantity)}` : ""}{part.external && part.unitPrice !== undefined ? ` · Venta ${money(part.unitPrice * part.quantity)}` : ""}</p>
              </div>
              <div><label className="text-xs font-medium">Garantía (días)</label><input type="number" min="0" max="3650" value={part.warrantyDays ?? 0} onChange={(event) => setParts(current => current.map(item => item.id === part.id ? { ...item, warrantyDays: Number(event.target.value || 0) } : item))} className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm" /></div>
              <button type="button" disabled={savingId === part.id} onClick={() => void save(part)} className="h-10 self-end rounded-md border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50">{savingId === part.id ? "Guardando..." : "Guardar"}</button>
            </div>
          ))}
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !creating && setOpen(false)}>
          <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto" onClick={event => event.stopPropagation()}>
            <CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>Compra puntual / repuesto externo</CardTitle><p className="mt-1 text-sm text-muted-foreground">Úsalo cuando compras una pieza específicamente para esta reparación y no la tienes en stock.</p></div><Button variant="ghost" size="icon" onClick={() => !creating && setOpen(false)}><X className="h-4 w-4" /></Button></div></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2"><div><label className="text-sm font-medium">Nombre del repuesto</label><input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" placeholder="Pantalla iPhone 15 Pro Max GX" /></div><div><label className="text-sm font-medium">Cantidad</label><input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" /></div></div>
              <div className="grid gap-3 sm:grid-cols-2"><div><label className="text-sm font-medium">Costo de compra</label><input type="number" min="0" value={purchaseCost} onChange={e => setPurchaseCost(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" placeholder="380000" /></div><div><label className="text-sm font-medium">Precio al cliente</label><input type="number" min="0" value={salePrice} onChange={e => setSalePrice(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" placeholder="650000" /></div></div>
              <div className="grid gap-3 sm:grid-cols-2"><div><label className="text-sm font-medium">Garantía (días)</label><input type="number" min="0" max="3650" value={warrantyDays} onChange={e => setWarrantyDays(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" /></div><div><label className="text-sm font-medium">Proveedor (texto opcional)</label><input value={supplierName} onChange={e => setSupplierName(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" placeholder="Proveedor donde la compraste" /></div></div>
              <div><label className="text-sm font-medium">Factura / referencia (opcional)</label><input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" placeholder="Factura o referencia de compra" /></div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4"><input type="checkbox" checked={addToInventory} onChange={e => setAddToInventory(e.target.checked)} className="mt-1 h-4 w-4" /><span><span className="font-medium">Agregar también al inventario</span><span className="mt-1 block text-xs text-muted-foreground">Si está desmarcado, la compra solo queda en esta reparación y no modifica el stock.</span></span></label>
              {addToInventory && <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2"><div><label className="text-sm font-medium">Categoría</label><select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Selecciona categoría</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div><label className="text-sm font-medium">Proveedor del inventario</label><select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Selecciona proveedor</option>{suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><p className="text-xs text-muted-foreground sm:col-span-2">Stockly creará el producto con un SKU automático y la cantidad comprada. Luego podrás usarlo normalmente en otras reparaciones.</p></div>}
              <div className="flex justify-end gap-2"><Button variant="outline" disabled={creating} onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={creating || !name.trim() || !purchaseCost || !salePrice || !quantity || (addToInventory && (!categoryId || !supplierId))} onClick={() => void createSpotPart()}>{creating ? "Guardando..." : <><Plus className="mr-2 h-4 w-4" />Agregar repuesto</>}</Button></div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
