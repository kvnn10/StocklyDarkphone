"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Banknote, Building2, Check, CreditCard,
  Minus, Plus, ReceiptText, Search, ShoppingBag, Smartphone, Trash2,
  WalletCards, X, PencilLine, Boxes, PlusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageSectionHeader } from "@/components/shared/PageSectionHeader";
import { useProducts } from "@/hooks/queries";

interface ClientOption { id: string; name: string; email?: string; phone?: string; status?: boolean; }
interface DeviceTracking { imei?: string | null; serial?: string | null; capacity?: string | null; color?: string | null; batteryHealth?: number | null; condition?: string | null; warrantyUntil?: string | null; }
interface StockRow { id: string; warehouseId: string; warehouseName?: string | null; quantity: number; reservedQuantity: number; }
interface Variant { id: string; name: string; sku: string; price: number; purchasePrice: number; quantity: number; reservedQuantity: number; attributes?: Record<string, unknown> | null; stocks: StockRow[]; }
interface CartLine { productId: string; variantId?: string; name: string; sku: string; imageUrl?: string | null; price: number; purchasePrice: number; quantity: number; maxQuantity: number; warehouseId?: string; device?: DeviceTracking | null; freeDescription?: string; }
type PaymentMethod = "cash" | "card" | "transfer" | "nequi" | "daviplata" | "bold" | "other";
type SaleMode = "paid" | "debt";

const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Math.max(0, value));
const deviceFromVariant = (variant: Variant): DeviceTracking | null => {
  const raw = variant.attributes?.deviceTracking;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as DeviceTracking : null;
};
const paymentOptions: Array<[PaymentMethod, string, typeof Banknote]> = [
  ["cash", "Efectivo", Banknote],
  ["card", "Tarjeta", CreditCard],
  ["transfer", "Transferencia", Building2],
  ["nequi", "Nequi", WalletCards],
  ["daviplata", "Daviplata", WalletCards],
  ["bold", "Bold", CreditCard],
  ["other", "Otro", WalletCards],
];

export default function SalesPage() {
  const { data: products = [], isLoading } = useProducts();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [search, setSearch] = useState("");
  const [entryMode, setEntryMode] = useState<"catalog" | "free">("catalog");
  const [freeDescription, setFreeDescription] = useState("");
  const [freePrice, setFreePrice] = useState("");
  const [freeQuantity, setFreeQuantity] = useState("1");
  const [stockFilter, setStockFilter] = useState<"all" | "low">("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantProduct, setVariantProduct] = useState<(typeof products)[number] | null>(null);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("none");
  const [mode, setMode] = useState<SaleMode>("paid");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/clients", { credentials: "include" })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => setClients(Array.isArray(data) ? data.filter((client) => client.status !== false) : []))
      .catch(() => setClients([]));
  }, []);

  const availableProducts = useMemo(() => products.filter((p) => !p.deletedAt && Number(p.quantity ?? 0) > 0), [products]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return availableProducts.filter((p) => {
      const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      const matchesStock = stockFilter === "all" || Number(p.quantity ?? 0) <= 2;
      return matchesSearch && matchesStock;
    });
  }, [availableProducts, search, stockFilter]);

  const subtotal = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const safeDiscount = Math.min(Math.max(discount, 0), subtotal);
  const total = subtotal - safeDiscount;
  const change = paymentMethod === "cash" ? Math.max(cashReceived - total, 0) : 0;
  const cashIsValid = mode === "debt" || paymentMethod !== "cash" || cashReceived >= total;
  const debtNeedsClient = mode === "debt" && clientId === "none";
  const canContinue = cart.length > 0 && !debtNeedsClient;

  async function chooseProduct(product: (typeof products)[number]) {
    setMessage("");
    setLoadingVariants(true);
    try {
      const response = await fetch(`/api/products/${product.id}/variants`, { cache: "no-store" });
      const data = response.ok ? await response.json() : [];
      const available = Array.isArray(data) ? (data as Variant[]).filter((v) => Number(v.quantity) - Number(v.reservedQuantity) > 0) : [];
      if (available.length > 0) {
        setVariants(available);
        setVariantProduct(product);
        return;
      }
      addLine({ productId: product.id, name: product.name, sku: product.sku, imageUrl: product.imageUrl, price: Number(product.price), purchasePrice: Number(product.purchasePrice ?? 0), quantity: 1, maxQuantity: Number(product.quantity) });
    } catch {
      addLine({ productId: product.id, name: product.name, sku: product.sku, imageUrl: product.imageUrl, price: Number(product.price), purchasePrice: Number(product.purchasePrice ?? 0), quantity: 1, maxQuantity: Number(product.quantity) });
    } finally {
      setLoadingVariants(false);
    }
  }

  function addLine(line: CartLine) {
    setCart((current) => {
      const key = line.variantId ? `${line.productId}:${line.variantId}` : line.productId;
      const existing = current.find((item) => `${item.productId}:${item.variantId ?? ""}` === key);
      if (existing && !line.variantId) return current.map((item) => item === existing ? { ...item, quantity: Math.min(item.quantity + 1, item.maxQuantity) } : item);
      return [...current, line];
    });
  }

  function addFreeItem() {
    const description = freeDescription.trim();
    const price = Number(freePrice);
    const quantity = Math.max(1, Math.floor(Number(freeQuantity) || 1));
    const anchor = availableProducts[0];
    if (!description || !Number.isFinite(price) || price <= 0 || !anchor) return;
    addLine({
      productId: anchor.id,
      name: description,
      sku: "LIBRE",
      imageUrl: null,
      price,
      purchasePrice: 0,
      quantity,
      maxQuantity: 999,
      freeDescription: description,
    });
    setFreeDescription("");
    setFreePrice("");
    setFreeQuantity("1");
    setEntryMode("catalog");
  }

  function chooseVariant(variant: Variant) {
    if (!variantProduct) return;
    const device = deviceFromVariant(variant);
    const stock = variant.stocks.find((row) => row.quantity - row.reservedQuantity > 0);
    addLine({
      productId: variantProduct.id,
      variantId: variant.id,
      name: variantProduct.name,
      sku: variant.sku,
      imageUrl: variantProduct.imageUrl,
      price: Number(variant.price),
      purchasePrice: Number(variant.purchasePrice),
      quantity: 1,
      maxQuantity: Math.max(1, Number(variant.quantity) - Number(variant.reservedQuantity)),
      warehouseId: stock?.warehouseId,
      device,
    });
    setVariantProduct(null);
    setVariants([]);
  }

  function changeQuantity(index: number, delta: number) {
    setCart((current) => current.map((line, i) => i !== index ? line : { ...line, quantity: Math.min(Math.max(line.quantity + delta, 1), line.maxQuantity) }));
  }

  function changePrice(index: number, value: string) {
    const price = Number(value);
    setCart((current) => current.map((line, i) => i !== index ? line : { ...line, price: Number.isFinite(price) ? Math.max(0, price) : 0 }));
  }

  function goToConfirm() {
    if (canContinue) setStep(2);
  }

  function goToPayment() {
    if (cart.length) {
      setCashReceived(total);
      setStep(3);
    }
  }

  async function completeSale() {
    if (!cart.length || isSaving || !cashIsValid || debtNeedsClient) return;
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          items: cart.map((line) => ({ productId: line.productId, variantId: line.variantId, quantity: line.quantity, unitPrice: line.price, warehouseId: line.warehouseId, ...(line.freeDescription ? { freeDescription: line.freeDescription } : {}) })),
          clientId: clientId === "none" ? null : clientId,
          discount: safeDiscount,
          tax: 0,
          shipping: 0,
          notes: notes.trim() || "Venta creada desde POS",
          paymentStatus: "unpaid",
        }),
      });
      const sale = await response.json();
      if (!response.ok) throw new Error(sale.error || "No se pudo registrar la venta");

      if (mode === "paid") {
        const paymentResponse = await fetch("/api/sales/pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ orderId: sale.id, paymentMethod, cashReceived: paymentMethod === "cash" ? cashReceived : undefined }),
        });
        const payment = await paymentResponse.json();
        if (!paymentResponse.ok) throw new Error(payment.error || "No se pudo completar el pago");
        setMessage(`Venta ${payment.orderNumber} registrada por ${money(payment.amount)}.${payment.change > 0 ? ` Cambio: ${money(payment.change)}.` : ""}`);
      } else {
        setMessage(`Venta ${sale.orderNumber} registrada como deuda por ${money(sale.total)}.`);
      }

      setStep(1);
      setCart([]);
      setClientId("none");
      setDiscount(0);
      setNotes("");
      setMode("paid");
      setPaymentMethod("cash");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo completar la venta");
    } finally {
      setIsSaving(false);
    }
  }

  const stepTitle = step === 1 ? "Agregar productos" : step === 2 ? "Confirma precios y cantidades" : "Nueva venta";

  return (
    <main className="min-h-full bg-background p-3 pb-28 sm:p-6 sm:pb-8">
      <PageSectionHeader
        title="Ventas"
        description="Registra ventas, pagos y deudas desde un flujo rápido para DarkPhone."
        tone="emerald"
        icon={ShoppingBag}
        trailing={<div className="flex items-center gap-2"><Link href="/"><Button variant="outline" className="gap-2">Inicio</Button></Link><Link href="/orders"><Button variant="outline" className="hidden gap-2 sm:inline-flex">Ver pedidos <ArrowRight className="h-4 w-4" /></Button></Link></div>}
      />

      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between rounded-2xl border bg-card/80 p-3 shadow-sm backdrop-blur-xl">
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((number) => (
              <div key={number} className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${step === number ? "bg-emerald-600 text-white" : step > number ? "bg-emerald-500/15 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                {step > number ? <Check className="h-4 w-4" /> : number}
              </div>
            ))}
          </div>
          <span className="text-sm font-semibold">{stepTitle}</span>
          <span className="text-xs text-muted-foreground">Paso {step} de 3</span>
        </div>

        {step === 1 && (
          <section className="rounded-3xl border bg-card/80 p-4 shadow-sm backdrop-blur-xl sm:p-5">
            <div className="mb-4 rounded-2xl border bg-muted/30 p-1">
              <div className="grid grid-cols-2 gap-1">
                <button type="button" onClick={() => setEntryMode("catalog")} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold ${entryMode === "catalog" ? "bg-background shadow-sm" : "text-muted-foreground"}`}><Boxes className="h-4 w-4" />Productos del inventario</button>
                <button type="button" onClick={() => setEntryMode("free")} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold ${entryMode === "free" ? "bg-background shadow-sm" : "text-muted-foreground"}`}><PencilLine className="h-4 w-4" />Venta libre</button>
              </div>
            </div>
            <div className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 text-sm text-muted-foreground">
              Puedes combinar productos existentes con ítems libres. Los ítems libres llevan una descripción y un valor, y no descuentan inventario.
            </div>
            {entryMode === "free" ? (
              <div className="rounded-2xl border bg-background p-4 sm:p-5">
                <div className="mb-5 flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><PlusCircle className="h-5 w-5" /></div><div><h3 className="font-semibold">Agregar ítem de venta libre</h3><p className="text-sm text-muted-foreground">Úsalo para servicios, accesorios u otros conceptos que no estén en inventario.</p></div></div>
                <div className="grid gap-3 sm:grid-cols-[1fr_180px_120px]">
                  <div><label className="mb-1.5 block text-xs font-semibold text-muted-foreground">¿Qué estás vendiendo?</label><Input value={freeDescription} onChange={(e) => setFreeDescription(e.target.value)} placeholder="Ej. Instalación de protector" className="h-12 rounded-xl" /></div>
                  <div><label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Valor</label><Input type="number" min="1" value={freePrice} onChange={(e) => setFreePrice(e.target.value)} placeholder="$ 0" className="h-12 rounded-xl" /></div>
                  <div><label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Cantidad</label><Input type="number" min="1" step="1" value={freeQuantity} onChange={(e) => setFreeQuantity(e.target.value)} className="h-12 rounded-xl" /></div>
                </div>
                <div className="mt-4 flex justify-end"><Button type="button" onClick={addFreeItem} disabled={!freeDescription.trim() || Number(freePrice) <= 0 || !availableProducts.length} className="h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700"><Plus className="mr-2 h-4 w-4" />Agregar a la venta</Button></div>
                {!availableProducts.length && <p className="mt-3 text-xs text-rose-600">Necesitas tener al menos un producto creado para registrar una venta libre.</p>}
              </div>
            ) : (
            <>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto, SKU o IMEI..." className="h-12 rounded-xl pl-10" />
              </div>
              <div className="flex rounded-xl border bg-muted/40 p-1">
                <button type="button" onClick={() => setStockFilter("all")} className={`rounded-lg px-3 py-2 text-sm font-medium ${stockFilter === "all" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>Todas</button>
                <button type="button" onClick={() => setStockFilter("low")} className={`rounded-lg px-3 py-2 text-sm font-medium ${stockFilter === "low" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>Unidades bajas</button>
              </div>
            </div>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Selecciona un producto para agregarlo a la venta.</p>
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">{availableProducts.length} disponibles</span>
            </div>
            {isLoading || loadingVariants ? (
              <div className="py-16 text-center text-muted-foreground">Cargando inventario...</div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed py-16 text-center text-sm text-muted-foreground">No encontramos productos con esos criterios.</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((product) => (
                  <button key={product.id} type="button" onClick={() => chooseProduct(product)} className="group rounded-2xl border bg-background p-3 text-left transition hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-md">
                    <div className="flex gap-3">
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
                        {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" /> : <Smartphone className="h-8 w-8 text-muted-foreground/50" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{product.name}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">SKU {product.sku}</p>
                        <p className="mt-2 text-lg font-bold">{money(Number(product.price))}</p>
                      </div>
                      <Plus className="mt-1 h-5 w-5 shrink-0 text-emerald-500" />
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300">{Number(product.quantity)} disponibles</span>
                      <span className="text-xs text-muted-foreground">Toca para agregar</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            </>
          </section>
        )}

        {step === 2 && (
          <section className="rounded-3xl border bg-card/80 p-4 shadow-sm backdrop-blur-xl sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Volver</button>
              <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">Las unidades seleccionadas se descontarán del inventario</span>
            </div>
            <div className="space-y-3">
              {cart.map((line, index) => (
                <div key={`${line.productId}:${line.variantId ?? index}`} className="rounded-2xl border bg-background p-4">
                  <div className="flex gap-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">{line.imageUrl ? <img src={line.imageUrl} alt="" className="h-full w-full object-cover" /> : <Smartphone className="h-6 w-6 text-muted-foreground/50" />}</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{line.name}</p>
                      <p className="text-xs text-muted-foreground">{line.sku}</p>
                      {line.device && <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                        {line.device.imei && <span className="rounded-full bg-muted px-2 py-1 font-mono">IMEI {line.device.imei}</span>}
                        {line.device.serial && <span className="rounded-full bg-muted px-2 py-1 font-mono">SN {line.device.serial}</span>}
                        {line.device.capacity && <span className="rounded-full bg-muted px-2 py-1">{line.device.capacity}</span>}
                        {line.device.batteryHealth != null && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">Batería {line.device.batteryHealth}%</span>}
                      </div>}
                    </div>
                    <button type="button" onClick={() => setCart((current) => current.filter((_, i) => i !== index))} className="self-start rounded-lg p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr_1fr] sm:items-end">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Cantidad</label>
                      <div className="flex h-11 items-center justify-between rounded-xl border px-2">
                        <button type="button" disabled={line.variantId != null || line.quantity <= 1} onClick={() => changeQuantity(index, -1)} className="rounded-lg p-1.5 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                        <span className="font-semibold">{line.quantity}</span>
                        <button type="button" disabled={line.variantId != null || line.quantity >= line.maxQuantity} onClick={() => changeQuantity(index, 1)} className="rounded-lg p-1.5 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                      </div>
                    </div>
                    <div><label className="mb-1 block text-xs font-medium text-muted-foreground">Precio unitario</label><Input type="number" min="0" value={line.price} onChange={(e) => changePrice(index, e.target.value)} className="h-11 rounded-xl" /></div>
                    <div className="text-right"><p className="text-xs text-muted-foreground">Precio por {line.quantity} unidad{line.quantity === 1 ? "" : "es"}</p><p className="text-xl font-bold">{money(line.price * line.quantity)}</p></div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-end justify-between border-t pt-5">
              <div><p className="text-sm text-muted-foreground">Subtotal</p><p className="text-2xl font-bold">{money(subtotal)}</p></div>
              <Button onClick={goToPayment} disabled={!cart.length} className="h-12 gap-2 rounded-xl bg-emerald-600 px-6 hover:bg-emerald-700">Continuar <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="rounded-3xl border bg-card/80 p-4 shadow-sm backdrop-blur-xl sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <button type="button" onClick={() => setStep(2)} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Volver</button>
              <div className="rounded-xl border bg-muted/40 p-1">
                <button type="button" onClick={() => setMode("paid")} className={`rounded-lg px-5 py-2 text-sm font-semibold ${mode === "paid" ? "bg-emerald-600 text-white" : "text-muted-foreground"}`}>Pagado</button>
                <button type="button" onClick={() => setMode("debt")} className={`rounded-lg px-5 py-2 text-sm font-semibold ${mode === "debt" ? "bg-rose-600 text-white" : "text-muted-foreground"}`}>Deuda</button>
              </div>
            </div>
            {mode === "debt" && <div className="mb-5 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-800 dark:text-blue-200"><strong>Venta a crédito.</strong> Al finalizar se registrará en Deudas y necesitará un cliente.</div>}
            <div className="mb-5 flex items-center justify-between rounded-2xl border bg-background px-4 py-4">
              <div><p className="text-sm font-semibold">Fecha de la venta</p><p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "long", year: "numeric" }).format(new Date())}</p></div>
              <ReceiptText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="mb-6 rounded-2xl border bg-background p-4">
              <div className="mb-3 flex items-center justify-between"><span className="text-sm text-muted-foreground">Valor total</span><span className="text-2xl font-bold">{money(total)}</span></div>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]"><div><label className="mb-1 block text-xs font-medium text-muted-foreground">Descuento</label><Input type="number" min="0" max={subtotal} value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} className="h-11 rounded-xl" /></div><div className="flex items-end pb-2 text-sm text-muted-foreground">= {money(safeDiscount)}</div></div>
            </div>
            {mode === "paid" && <div className="mb-6">
              <h3 className="mb-3 text-base font-semibold">Selecciona el método de pago</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {paymentOptions.map(([value, label, Icon]) => <button key={value} type="button" onClick={() => setPaymentMethod(value)} className={`min-h-24 rounded-2xl border p-3 text-left transition ${paymentMethod === value ? "border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/10" : "bg-background hover:border-emerald-400/40"}`}><Icon className={`mb-3 h-5 w-5 ${paymentMethod === value ? "text-emerald-600" : "text-muted-foreground"}`} /><p className="text-sm font-semibold">{label}</p></button>)}
              </div>
              {paymentMethod === "cash" && <div className="mt-3 rounded-2xl border bg-background p-4"><label className="mb-2 block text-sm font-medium">Efectivo recibido</label><Input type="number" min={total} value={cashReceived} onChange={(e) => setCashReceived(Number(e.target.value) || 0)} className="h-11 rounded-xl" /><div className="mt-2 flex justify-between text-sm"><span className="text-muted-foreground">Cambio</span><strong className="text-emerald-600">{money(change)}</strong></div></div>}
            </div>}
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <div><label className="mb-1.5 block text-sm font-semibold">Cliente{mode === "debt" ? " *" : ""}</label><select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-12 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"><option value="none">Selecciona un cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.phone ? ` — ${client.phone}` : ""}</option>)}</select>{debtNeedsClient && <p className="mt-1 text-xs text-rose-600">Selecciona un cliente para registrar una deuda.</p>}</div>
              <div><label className="mb-1.5 block text-sm font-semibold">Notas</label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. equipo entregado con caja" className="h-12 rounded-xl" /></div>
            </div>
            {message && <div className="mb-4 rounded-2xl border bg-muted/40 p-4 text-sm">{message}</div>}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">{cart.length} producto{cart.length === 1 ? "" : "s"} · Total {money(total)}</p><Button disabled={isSaving || !cashIsValid || debtNeedsClient} onClick={completeSale} className="h-14 w-full rounded-2xl bg-emerald-600 text-base font-semibold hover:bg-emerald-700 sm:w-auto sm:min-w-72">{isSaving ? "Registrando…" : mode === "paid" ? `Crear venta · ${money(total)}` : `Crear deuda · ${money(total)}`}<ArrowRight className="h-5 w-5" /></Button></div>
          </section>
        )}
      </div>

      {message && step === 1 && <div className="mx-auto mt-4 max-w-5xl rounded-2xl border bg-card p-4 text-sm shadow-sm">{message}</div>}
      {cart.length > 0 && step === 1 && <div className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-5xl rounded-2xl border bg-card/95 p-3 shadow-2xl backdrop-blur-xl sm:static sm:mt-5 sm:flex sm:items-center sm:justify-between sm:bg-card"><div className="mb-2 sm:mb-0"><p className="font-semibold">{cart.length} producto{cart.length === 1 ? "" : "s"} seleccionado{cart.length === 1 ? "" : "s"}</p><p className="text-sm text-muted-foreground">Total provisional: {money(subtotal)}</p></div><Button onClick={goToConfirm} className="h-11 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 sm:w-auto">Continuar <ArrowRight className="h-4 w-4" /></Button></div>}

      {variantProduct && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"><div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-t-3xl border bg-card shadow-2xl sm:rounded-3xl"><div className="flex items-center justify-between border-b p-5"><div><p className="text-xs font-medium uppercase tracking-wide text-emerald-600">Selecciona el equipo</p><h2 className="mt-1 text-xl font-bold">{variantProduct.name}</h2><p className="text-sm text-muted-foreground">Cada unidad registrada conserva su IMEI, serial y batería.</p></div><button type="button" onClick={() => { setVariantProduct(null); setVariants([]); }} className="rounded-xl p-2 hover:bg-muted"><X className="h-5 w-5" /></button></div><div className="max-h-[60vh] space-y-2 overflow-y-auto p-4">{variants.map((variant) => { const device = deviceFromVariant(variant); return <button key={variant.id} type="button" onClick={() => chooseVariant(variant)} className="w-full rounded-2xl border bg-background p-4 text-left transition hover:border-emerald-500/50 hover:bg-emerald-500/[0.03]"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{variant.name}</p><p className="mt-1 text-xs text-muted-foreground">SKU {variant.sku}</p><div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">{device?.imei && <span className="rounded-full bg-muted px-2 py-1 font-mono">IMEI {device.imei}</span>}{device?.serial && <span className="rounded-full bg-muted px-2 py-1 font-mono">SN {device.serial}</span>}{device?.capacity && <span className="rounded-full bg-muted px-2 py-1">{device.capacity}</span>}{device?.color && <span className="rounded-full bg-muted px-2 py-1">{device.color}</span>}{device?.batteryHealth != null && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">Batería {device.batteryHealth}%</span>}</div></div><div className="text-right"><p className="text-lg font-bold">{money(Number(variant.price))}</p><p className="text-xs text-muted-foreground">{Math.max(0, Number(variant.quantity) - Number(variant.reservedQuantity))} disponible</p></div></div></button>; })}</div></div></div>}
    </main>
  );
}
