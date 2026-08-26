"use client";
import { useEffect, useMemo, useState } from "react";

type Supplier = { id: string; name: string };
type Product = { id: string; name: string; sku: string; purchasePrice: number; quantity: number | string };
type Row = { productId: string; quantity: number; unitCost: number };
type Purchase = { id: string; purchaseNumber: string; supplierId: string; status: string; total: number; createdAt: string; items: Array<{ productName: string; orderedQuantity: number; receivedQuantity: number; unitCost: number }> };

const money = (v: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v || 0);

export default function PurchaseOrdersWorkspace() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Purchase[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const selectedProduct = products.find((p) => p.id === productId);
  const total = useMemo(() => rows.reduce((s, r) => s + r.quantity * r.unitCost, 0), [rows]);

  async function load() {
    const [s, p, o] = await Promise.all([fetch("/api/suppliers"), fetch("/api/products"), fetch("/api/purchase-orders")]);
    if (s.ok) setSuppliers(await s.json());
    if (p.ok) { const data = await p.json(); setProducts(Array.isArray(data) ? data : data.products ?? []); }
    if (o.ok) setOrders(await o.json());
  }
  useEffect(() => { load().catch(() => setMessage("No se pudieron cargar los datos.")); }, []);
  useEffect(() => { if (selectedProduct) setUnitCost(Number(selectedProduct.purchasePrice) || 0); }, [selectedProduct]);

  function addRow() {
    if (!productId || quantity < 1 || unitCost < 0) return;
    setRows((current) => [...current, { productId, quantity: Math.floor(quantity), unitCost: Number(unitCost) }]);
    setProductId(""); setQuantity(1); setUnitCost(0);
  }
  async function createOrder() {
    if (!supplierId || !rows.length) return setMessage("Selecciona proveedor y productos.");
    setLoading(true); setMessage("");
    try {
      const res = await fetch("/api/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplierId, items: rows }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear la orden");
      setMessage(`Orden ${data.purchaseNumber} creada correctamente.`); setRows([]); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Error creando la orden"); }
    finally { setLoading(false); }
  }
  async function receive(order: Purchase) {
    if (!confirm(`¿Marcar ${order.purchaseNumber} como recibida? Esto aumentará el inventario y actualizará el costo promedio.`)) return;
    setLoading(true); setMessage("");
    try {
      const res = await fetch("/api/purchase-orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: order.id, status: "received" }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "No se pudo recibir");
      setMessage(`${order.purchaseNumber} recibida. Inventario y costos actualizados.`); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Error recibiendo la orden"); }
    finally { setLoading(false); }
  }

  return <div className="space-y-6">
    <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
      <div className="mb-5"><h1 className="text-xl font-semibold">Compras a proveedores</h1><p className="text-sm text-muted-foreground">Crea órdenes y al recibirlas actualiza automáticamente stock y costo promedio.</p></div>
      {message && <div className="mb-4 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">{message}</div>}
      <div className="grid gap-3 md:grid-cols-4">
        <select className="rounded-lg border bg-background p-2" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Proveedor</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select className="rounded-lg border bg-background p-2" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Producto</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select>
        <input className="rounded-lg border bg-background p-2" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} placeholder="Cantidad" />
        <input className="rounded-lg border bg-background p-2" type="number" min={0} value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value))} placeholder="Costo unitario" />
      </div>
      <div className="mt-3 flex items-center justify-between"><button className="rounded-lg border px-4 py-2 text-sm" onClick={addRow}>Agregar producto</button><span className="text-sm font-semibold">Total: {money(total)}</span></div>
      {rows.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">Producto</th><th>Cant.</th><th>Costo</th><th>Total</th><th></th></tr></thead><tbody>{rows.map((r, i) => { const p = products.find(x => x.id === r.productId); return <tr key={`${r.productId}-${i}`} className="border-b border-white/5"><td className="py-2">{p?.name ?? r.productId}</td><td>{r.quantity}</td><td>{money(r.unitCost)}</td><td>{money(r.quantity * r.unitCost)}</td><td><button className="text-red-400" onClick={() => setRows(rows.filter((_, x) => x !== i))}>Quitar</button></td></tr>; })}</tbody></table></div>}
      <button disabled={loading || !rows.length || !supplierId} onClick={createOrder} className="mt-5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{loading ? "Procesando…" : "Crear orden de compra"}</button>
    </div>

    <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5"><h2 className="mb-4 text-lg font-semibold">Historial de órdenes</h2><div className="space-y-3">{orders.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay órdenes de compra.</p> : orders.map(o => <div key={o.id} className="flex flex-col gap-3 rounded-xl border border-white/10 p-4 md:flex-row md:items-center md:justify-between"><div><div className="font-medium">{o.purchaseNumber}</div><div className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString("es-CO")} · {o.items.length} productos · {money(o.total)}</div><div className="mt-1 text-xs">Estado: <b>{o.status}</b></div></div>{o.status !== "received" && o.status !== "cancelled" && <button disabled={loading} onClick={() => receive(o)} className="rounded-lg border px-4 py-2 text-sm">Recibir mercancía</button>}</div>)}</div></div>
  </div>;
}
