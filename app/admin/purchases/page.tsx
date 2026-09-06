"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, ShoppingBag, CreditCard, Banknote, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContentWrapper } from "@/components/shared";

type Product = { id: string; name: string; sku: string; purchasePrice?: number; quantity?: number };
type Supplier = { id: string; name: string; status?: boolean };
type Warehouse = { id: string; name: string; status?: boolean };
type Line = { productId: string; quantity: number; unitCost: number };
type Purchase = { id: string; purchaseNumber: string; supplierName: string; total: number; paymentMode: string; paymentMethod?: string; createdAt: string; items: Array<{ productName: string; sku?: string; receivedQuantity: number; unitCost: number }> ; payable?: { amountDue?: number; status?: string } | null };

const money = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n || 0);
const methods: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", other: "Otro" };

export default function PurchasesPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [paymentMode, setPaymentMode] = useState<"paid" | "credit">("paid");
  const [paymentMethod, setPaymentMethod] = useState("transfer");
  const [dueDate, setDueDate] = useState("");
  const [tax, setTax] = useState("");
  const [shipping, setShipping] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: 1, unitCost: 0 }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [p, s, w, h] = await Promise.all([
        fetch("/api/products").then((r) => r.json()),
        fetch("/api/suppliers").then((r) => r.json()),
        fetch("/api/warehouses").then((r) => r.json()),
        fetch("/api/purchases").then((r) => r.json()),
      ]);
      setProducts(Array.isArray(p) ? p : []);
      setSuppliers(Array.isArray(s) ? s.filter((x) => x.status !== false) : []);
      setWarehouses(Array.isArray(w) ? w.filter((x) => x.status !== false) : []);
      setPurchases(Array.isArray(h) ? h : []);
      if (!supplierId && Array.isArray(s) && s.length) setSupplierId(s.find((x: Supplier) => x.status !== false)?.id ?? s[0].id);
      if (!warehouseId && Array.isArray(w) && w.length) setWarehouseId(w.find((x: Warehouse) => x.status !== false)?.id ?? w[0].id);
    } catch { setMessage("No se pudieron cargar los datos de compras."); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + Math.max(0, line.quantity) * Math.max(0, line.unitCost), 0), [lines]);
  const total = subtotal + Math.max(0, Number(tax) || 0) + Math.max(0, Number(shipping) || 0);

  const updateLine = (index: number, patch: Partial<Line>) => setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  const selectProduct = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    updateLine(index, { productId, unitCost: Number(product?.purchasePrice ?? 0) });
  };

  const save = async () => {
    setMessage("");
    if (!supplierId || !warehouseId) return setMessage("Selecciona proveedor y almacén.");
    if (lines.some((line) => !line.productId || line.quantity <= 0 || line.unitCost < 0)) return setMessage("Completa correctamente todos los productos.");
    setSaving(true);
    try {
      const response = await fetch("/api/purchases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplierId, warehouseId, paymentMode, paymentMethod, dueDate: dueDate || undefined, tax: Number(tax) || 0, shipping: Number(shipping) || 0, notes, items: lines }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar la compra");
      setMessage(`Compra ${data.purchaseNumber} registrada correctamente.`);
      setLines([{ productId: "", quantity: 1, unitCost: 0 }]); setTax(""); setShipping(""); setNotes(""); setDueDate("");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo registrar la compra"); }
    finally { setSaving(false); }
  };

  return <PageContentWrapper>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Compras</h1><p className="text-sm text-muted-foreground">Abastece inventario y deja trazabilidad financiera automáticamente.</p></div>
        <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" />Actualizar</Button>
      </div>

      {message && <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">{message}</div>}

      <section className="rounded-xl border bg-card p-5 shadow-sm space-y-5">
        <div className="flex items-center gap-2"><ShoppingBag className="h-5 w-5" /><h2 className="font-semibold">Nueva compra</h2></div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm space-y-1"><span>Proveedor</span><select className="h-10 w-full rounded-md border bg-background px-3" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Seleccionar...</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="text-sm space-y-1"><span>Almacén de entrada</span><select className="h-10 w-full rounded-md border bg-background px-3" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">Seleccionar...</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label className="text-sm space-y-1"><span>Forma de pago</span><select className="h-10 w-full rounded-md border bg-background px-3" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as "paid" | "credit")}><option value="paid">Pago inmediato</option><option value="credit">A crédito</option></select></label>
        </div>

        {paymentMode === "paid" ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm flex gap-2 items-center"><Banknote className="h-4 w-4" /> El pago se registra inmediatamente en Caja y Finanzas.</div> : <div className="grid gap-4 md:grid-cols-2"><label className="text-sm space-y-1"><span>Fecha de vencimiento</span><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label><div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm flex gap-2 items-center"><CreditCard className="h-4 w-4" /> Se crea automáticamente la cuenta por pagar al proveedor.</div></div>}

        {paymentMode === "paid" && <label className="text-sm space-y-1 block max-w-sm"><span>Método de pago</span><select className="h-10 w-full rounded-md border bg-background px-3" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>{Object.entries(methods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}

        <div className="space-y-3">
          {lines.map((line, index) => <div key={index} className="grid gap-2 md:grid-cols-[1fr_120px_160px_44px] items-end">
            <label className="text-sm space-y-1"><span>Producto</span><select className="h-10 w-full rounded-md border bg-background px-3" value={line.productId} onChange={(e) => selectProduct(index, e.target.value)}><option value="">Seleccionar producto...</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></label>
            <label className="text-sm space-y-1"><span>Cantidad</span><Input type="number" min="1" value={line.quantity} onChange={(e) => updateLine(index, { quantity: Math.max(1, Number(e.target.value) || 1) })} /></label>
            <label className="text-sm space-y-1"><span>Costo unitario</span><Input type="number" min="0" value={line.unitCost} onChange={(e) => updateLine(index, { unitCost: Math.max(0, Number(e.target.value) || 0) })} /></label>
            <Button variant="ghost" size="icon" onClick={() => setLines((current) => current.length > 1 ? current.filter((_, i) => i !== index) : current)} title="Eliminar línea"><Trash2 className="h-4 w-4" /></Button>
          </div>)}
          <Button variant="outline" onClick={() => setLines((current) => [...current, { productId: "", quantity: 1, unitCost: 0 }])}><Plus className="h-4 w-4" />Agregar producto</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3"><label className="text-sm space-y-1"><span>Impuestos</span><Input type="number" min="0" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0" /></label><label className="text-sm space-y-1"><span>Envío / otros</span><Input type="number" min="0" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0" /></label><label className="text-sm space-y-1"><span>Notas</span><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Factura, referencia, observaciones..." /></label></div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4"><div><p className="text-sm text-muted-foreground">Subtotal</p><p className="text-lg font-medium">{money(subtotal)}</p></div><div className="text-right"><p className="text-sm text-muted-foreground">Total de compra</p><p className="text-2xl font-semibold">{money(total)}</p></div><Button onClick={save} disabled={saving || loading}>{saving ? "Registrando..." : "Registrar compra"}</Button></div>
      </section>

      <section className="rounded-xl border bg-card shadow-sm overflow-hidden"><div className="border-b p-5"><h2 className="font-semibold">Historial de compras</h2></div>{purchases.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">Todavía no hay compras registradas.</div> : <div className="divide-y">{purchases.map((purchase) => <div key={purchase.id} className="p-4 flex flex-wrap items-center justify-between gap-4"><div><div className="font-medium">{purchase.purchaseNumber} · {purchase.supplierName}</div><div className="text-sm text-muted-foreground">{new Date(purchase.createdAt).toLocaleString("es-CO")} · {purchase.items.length} producto(s) · {purchase.paymentMode === "paid" ? `Pagado · ${methods[purchase.paymentMethod ?? "other"]}` : `A crédito · saldo ${money(Number(purchase.payable?.amountDue ?? 0))}`}</div></div><div className="font-semibold">{money(purchase.total)}</div></div>)}</div>}</section>
      <p className="text-xs text-muted-foreground">Los pagos a crédito pueden gestionarse desde <Link className="underline" href="/admin/finance">Finanzas / cuentas por pagar</Link>.</p>
    </div>
  </PageContentWrapper>;
}
