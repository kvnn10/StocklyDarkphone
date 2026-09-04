"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Banknote, CreditCard, Minus, Plus, Search, ShoppingCart, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageSectionHeader } from "@/components/shared/PageSectionHeader";
import { useProducts } from "@/hooks/queries";

interface CartLine { productId: string; name: string; sku: string; price: number; quantity: number; }
interface ClientOption { id: string; name: string; email: string; phone?: string; status?: boolean; }
type PaymentMethod = "cash" | "card" | "transfer" | "other";
const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);

export default function SalesPage() {
  const { data: products = [], isLoading } = useProducts();
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("none");
  const [discount, setDiscount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState(0);

  useEffect(() => {
    fetch("/api/clients", { credentials: "include" })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => setClients(Array.isArray(data) ? data.filter((client) => client.status !== false) : []))
      .catch(() => setClients([]));
  }, []);

  const availableProducts = useMemo(() => products.filter((p) => !p.deletedAt && Number(p.quantity ?? 0) > 0), [products]);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return !q ? availableProducts : availableProducts.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)); }, [availableProducts, search]);
  const subtotal = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const safeDiscount = Math.min(Math.max(discount, 0), subtotal);
  const total = subtotal - safeDiscount;
  const change = paymentMethod === "cash" ? Math.max(cashReceived - total, 0) : 0;
  const cashIsValid = paymentMethod !== "cash" || cashReceived >= total;

  function addProduct(product: (typeof products)[number]) {
    setMessage(""); setCart((current) => { const existing = current.find((line) => line.productId === product.id); if (existing) return current.map((line) => line.productId === product.id ? { ...line, quantity: Math.min(line.quantity + 1, Number(product.quantity)) } : line); return [...current, { productId: product.id, name: product.name, sku: product.sku, price: Number(product.price), quantity: 1 }]; });
  }
  function changeQuantity(productId: string, delta: number) {
    setCart((current) => current.map((line) => {
      if (line.productId !== productId) return line;
      const product = products.find((item) => item.id === productId);
      const max = Number(product?.quantity ?? line.quantity);
      return { ...line, quantity: Math.min(Math.max(line.quantity + delta, 0), max) };
    }).filter((line) => line.quantity > 0));
  }
  function handleProductSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const query = search.trim().toLowerCase();
    if (!query) return;
    const exact = availableProducts.find((product) => product.sku.toLowerCase() === query);
    if (exact) {
      e.preventDefault();
      addProduct(exact);
      setSearch("");
    }
  }
  function openPayment() {
    setPaymentMethod("cash");
    setCashReceived(total);
    setMessage("");
    setShowPayment(true);
  }

  async function completeSale() {
    if (!cart.length || isSaving || !cashIsValid) return;
    setIsSaving(true); setMessage("");
    try {
      const response = await fetch("/api/sales", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })), clientId: clientId === "none" ? null : clientId, discount: safeDiscount, tax: 0, shipping: 0, notes: "Venta creada desde POS" }) });
      const sale = await response.json(); if (!response.ok) throw new Error(sale.error || "No se pudo registrar la venta");
      const paymentResponse = await fetch("/api/sales/pay", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ orderId: sale.id, paymentMethod, cashReceived: paymentMethod === "cash" ? cashReceived : undefined }) });
      const payment = await paymentResponse.json(); if (!paymentResponse.ok) throw new Error(payment.error || "No se pudo completar el pago");
      setCart([]); setClientId("none"); setDiscount(0); setShowPayment(false); setMessage(`Venta ${payment.orderNumber} pagada correctamente por ${money(payment.amount)}.${payment.change > 0 ? ` Cambio: ${money(payment.change)}.` : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo completar la venta"); }
    finally { setIsSaving(false); }
  }

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <PageSectionHeader title="Ventas" description="Punto de venta para registrar ventas, clientes y pagos." tone="emerald" icon={ShoppingCart} trailing={<Link href="/orders"><Button variant="outline" className="gap-2">Ver pedidos <ArrowRight className="h-4 w-4" /></Button></Link>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <section className="rounded-2xl border bg-card/80 p-4 shadow-sm backdrop-blur-xl sm:p-5">
          <div className="mb-4 flex items-center gap-3"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={handleProductSearchKeyDown} placeholder="Buscar producto por nombre o SKU..." className="pl-9" /></div><div className="hidden rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-600 sm:block">{availableProducts.length} disponibles</div></div>
          {isLoading ? <div className="py-16 text-center text-muted-foreground">Cargando productos...</div> : filtered.length === 0 ? <div className="py-16 text-center text-muted-foreground">No hay productos que coincidan.</div> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((product) => <button key={product.id} type="button" onClick={() => addProduct(product)} className="group rounded-xl border bg-background p-4 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-500/50 hover:shadow-lg"><div className="mb-3 flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold">{product.name}</p><p className="text-xs text-muted-foreground">SKU {product.sku}</p></div><Plus className="h-5 w-5 shrink-0 text-emerald-500 transition-transform group-hover:scale-110" /></div><div className="flex items-end justify-between"><span className="text-lg font-bold">{money(Number(product.price))}</span><span className="text-xs text-muted-foreground">Stock: {Number(product.quantity)}</span></div></button>)}</div>}
        </section>
        <section className="rounded-2xl border bg-card/80 p-4 shadow-sm backdrop-blur-xl sm:p-5">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-semibold">Venta actual</h2><p className="text-sm text-muted-foreground">{cart.length} productos en el carrito</p></div><ShoppingCart className="h-5 w-5 text-emerald-500" /></div>
          <div className="mb-3 flex items-center gap-2"><UserRound className="h-4 w-4 text-muted-foreground" /><select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30"><option value="none">Cliente sin registrar</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.phone ? ` — ${client.phone}` : ""}</option>)}</select></div>
          <div className="max-h-[360px] space-y-2 overflow-auto pr-1">{cart.length === 0 ? <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">Agrega productos para comenzar la venta.</div> : cart.map((line) => <div key={line.productId} className="rounded-xl border bg-background p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{line.name}</p><p className="text-xs text-muted-foreground">{line.sku}</p></div><button type="button" onClick={() => setCart((c) => c.filter((x) => x.productId !== line.productId))}><X className="h-4 w-4 text-muted-foreground hover:text-destructive" /></button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-2 rounded-lg border px-1 py-1"><button type="button" className="p-1" onClick={() => changeQuantity(line.productId, -1)}><Minus className="h-3.5 w-3.5" /></button><span className="w-6 text-center text-sm font-medium">{line.quantity}</span><button type="button" className="p-1" onClick={() => changeQuantity(line.productId, 1)}><Plus className="h-3.5 w-3.5" /></button></div><span className="font-semibold">{money(line.price * line.quantity)}</span></div></div>)}</div>
          <div className="mt-5 space-y-3 border-t pt-4"><div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{money(subtotal)}</span></div><div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Descuento</span><Input type="number" min="0" max={subtotal} value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} className="h-9 w-32 text-right" /></div><div className="flex justify-between pt-2 text-xl font-bold"><span>Total</span><span className="text-emerald-600">{money(total)}</span></div>{message && <div className="rounded-lg border bg-muted/40 p-3 text-sm">{message}</div>}<Button onClick={openPayment} disabled={cart.length === 0 || isSaving} className="mt-1 w-full bg-emerald-600 hover:bg-emerald-700">Continuar al pago</Button></div>
        </section>
      </div>
      {showPayment && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-2xl"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-semibold">Confirmar pago</h2><p className="text-sm text-muted-foreground">Total a cobrar: {money(total)}</p></div><button type="button" onClick={() => setShowPayment(false)}><X /></button></div><div className="grid grid-cols-2 gap-3">{([['cash','Efectivo',Banknote],['card','Tarjeta',CreditCard],['transfer','Transferencia',ArrowRight],['other','Otro',ShoppingCart]] as const).map(([value,label,Icon]) => <button key={value} type="button" onClick={() => setPaymentMethod(value)} className={`rounded-xl border p-4 text-left transition ${paymentMethod === value ? 'border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/20' : 'hover:bg-muted'}`}><Icon className="mb-2 h-5 w-5 text-emerald-600" /><p className="font-medium">{label}</p></button>)}</div>{paymentMethod === "cash" && <div className="mt-4 space-y-2 rounded-xl border bg-background p-4"><label htmlFor="cash-received" className="text-sm font-medium">Efectivo recibido</label><Input id="cash-received" type="number" min={total} step="1" value={cashReceived} onChange={(e) => setCashReceived(Number(e.target.value) || 0)} autoFocus /><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Cambio</span><span className="font-bold text-emerald-600">{money(change)}</span></div>{!cashIsValid && <p className="text-sm text-destructive">El efectivo recibido debe ser igual o mayor al total.</p>}</div>}<Button disabled={isSaving || !cashIsValid} onClick={completeSale} className="mt-5 w-full bg-emerald-600 hover:bg-emerald-700">{isSaving ? "Registrando..." : `Cobrar ${money(total)}`}</Button></div></div>}
    </main>
  );
}
