"use client";

import { useEffect, useMemo, useState } from "react";
import { PageContentWrapper } from "@/components/shared";

type Product = { id: string; name: string; sku: string; price: number; quantity: number; imageUrl?: string | null };
type Client = { id: string; name?: string | null; email?: string | null; role?: string };
type CartItem = { product: Product; quantity: number };

type PaymentMethod = "cash" | "card" | "transfer" | "other";

const money = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

export default function SalesPOS() {
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("");
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/products").then((r) => r.ok ? r.json() : []),
      fetch("/api/users").then((r) => r.ok ? r.json() : []),
    ]).then(([productData, clientData]) => {
      setProducts(Array.isArray(productData) ? productData : []);
      setClients(Array.isArray(clientData) ? clientData.filter((u: Client) => u.role !== "admin") : []);
    }).catch(() => setError("No se pudieron cargar los datos del POS"))
      .finally(() => setLoading(false));
  }, []);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, query]);

  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const safeDiscount = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const total = subtotal - safeDiscount;

  function addProduct(product: Product) {
    if (product.quantity <= 0) return;
    setError("");
    setCart((current) => {
      const found = current.find((item) => item.product.id === product.id);
      if (found) {
        if (found.quantity >= product.quantity) return current;
        return current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...current, { product, quantity: 1 }];
    });
  }

  function changeQuantity(productId: string, quantity: number) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setCart((current) => current.map((item) => item.product.id === productId
      ? { ...item, quantity: Math.min(Math.max(quantity, 0), product.quantity) }
      : item).filter((item) => item.quantity > 0));
  }

  async function finishSale() {
    if (!cart.length || total <= 0) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId || undefined,
          // Send SKU as a stable fallback because /api/products is cached.
          items: cart.map((item) => ({ productId: item.product.id, sku: item.product.sku, quantity: item.quantity })),
          discount: safeDiscount,
          paymentStatus: "paid",
          paymentMethod,
          notes: "Venta registrada desde POS",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar la venta");
      setMessage(`Venta ${data.orderNumber ?? ""} registrada correctamente. Caja e inventario fueron actualizados.`);
      setCart([]); setDiscount(0);
      const refreshed = await fetch("/api/products");
      if (refreshed.ok) setProducts(await refreshed.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la venta");
    } finally { setSaving(false); }
  }

  return (
    <PageContentWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Ventas</h1>
          <p className="text-sm text-muted-foreground">POS · carrito · clientes · descuentos · pagos</p>
        </div>

        {message && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">{message}</div>}
        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">{error}</div>}

        <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
          <section className="rounded-2xl border bg-card p-4">
            <div className="mb-4 flex gap-3">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto por nombre o SKU..." className="w-full rounded-xl border bg-background px-4 py-3 outline-none" />
            </div>
            {loading ? <div className="py-12 text-center text-muted-foreground">Cargando productos...</div> : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProducts.map((product) => (
                  <button key={product.id} onClick={() => addProduct(product)} disabled={product.quantity <= 0} className="rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-40">
                    <div className="font-semibold">{product.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">SKU: {product.sku}</div>
                    <div className="mt-3 flex items-end justify-between"><span className="font-bold">{money(product.price)}</span><span className="text-xs text-muted-foreground">Stock: {product.quantity}</span></div>
                  </button>
                ))}
                {!filteredProducts.length && <div className="col-span-full py-12 text-center text-muted-foreground">No hay productos disponibles.</div>}
              </div>
            )}
          </section>

          <aside className="rounded-2xl border bg-card p-5">
            <h2 className="text-lg font-semibold">Nueva venta</h2>
            <div className="mt-4 space-y-3">
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full rounded-xl border bg-background px-3 py-3">
                <option value="">Cliente general</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name || client.email || client.id}</option>)}
              </select>

              <div className="space-y-2">
                {cart.map((item) => (
                  <div key={item.product.id} className="rounded-xl border p-3">
                    <div className="flex justify-between gap-3"><span className="font-medium">{item.product.name}</span><span>{money(item.product.price * item.quantity)}</span></div>
                    <div className="mt-2 flex items-center gap-2"><button onClick={() => changeQuantity(item.product.id, item.quantity - 1)} className="h-8 w-8 rounded-lg border">−</button><span className="w-8 text-center">{item.quantity}</span><button onClick={() => changeQuantity(item.product.id, item.quantity + 1)} className="h-8 w-8 rounded-lg border">+</button><button onClick={() => changeQuantity(item.product.id, 0)} className="ml-auto text-xs text-red-500">Quitar</button></div>
                  </div>
                ))}
                {!cart.length && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Agrega productos al carrito.</div>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">Descuento<input type="number" min="0" max={subtotal} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} className="mt-1 w-full rounded-xl border bg-background px-3 py-2" /></label>
                <label className="text-sm">Pago<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)} className="mt-1 w-full rounded-xl border bg-background px-3 py-2"><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="transfer">Transferencia</option><option value="other">Otro</option></select></label>
              </div>

              <div className="space-y-1 border-t pt-4 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div><div className="flex justify-between"><span>Descuento</span><span>- {money(safeDiscount)}</span></div><div className="flex justify-between text-xl font-bold"><span>Total</span><span>{money(total)}</span></div></div>
              <button onClick={finishSale} disabled={saving || !cart.length || total <= 0} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Registrando..." : "Cobrar y finalizar venta"}</button>
            </div>
          </aside>
        </div>
      </div>
    </PageContentWrapper>
  );
}
