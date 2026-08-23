"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Movement = { id: string; productId: string; warehouseId: string; type: string; quantity: string; previousStock: string; newStock: string; reason: string | null; referenceId: string | null; notes: string | null; createdAt: string };
type Product = { id: string; name: string; sku?: string | null; quantity?: number | string };
type Warehouse = { id: string; name: string; status?: boolean };

const labels: Record<string, string> = { entry: "Entrada", exit: "Salida", adjustment: "Ajuste", transfer_in: "Transferencia entrada", transfer_out: "Transferencia salida" };

export default function InventoryMovementsClient() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [type, setType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({ productId: "", warehouseId: "", type: "entry", quantity: "", reason: "", referenceId: "", notes: "" });

  async function load() {
    setLoading(true); setError("");
    try {
      const query = type === "all" ? "" : `?type=${encodeURIComponent(type)}`;
      const response = await fetch(`/api/inventory-movements${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar los movimientos");
      setMovements(Array.isArray(data) ? data : []);
    } catch (err) { setError(err instanceof Error ? err.message : "Error cargando movimientos"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [type]);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      setOptionsLoading(true);
      try {
        const [productsResponse, warehousesResponse] = await Promise.all([fetch("/api/products", { cache: "no-store" }), fetch("/api/warehouses", { cache: "no-store" })]);
        const [productsData, warehousesData] = await Promise.all([productsResponse.json(), warehousesResponse.json()]);
        if (!productsResponse.ok) throw new Error(productsData.error || "No se pudieron cargar los productos");
        if (!warehousesResponse.ok) throw new Error(warehousesData.error || "No se pudieron cargar los almacenes");
        if (!cancelled) {
          const nextProducts = Array.isArray(productsData) ? productsData : [];
          const nextWarehouses = Array.isArray(warehousesData) ? warehousesData.filter((w: Warehouse) => w.status !== false) : [];
          setProducts(nextProducts);
          setWarehouses(nextWarehouses);
          setForm((current) => ({ ...current, productId: current.productId || nextProducts[0]?.id || "", warehouseId: current.warehouseId || nextWarehouses[0]?.id || "" }));
        }
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : "No se pudieron cargar productos y almacenes"); }
      finally { if (!cancelled) setOptionsLoading(false); }
    }
    void loadOptions();
    return () => { cancelled = true; };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    try {
      if (!form.productId || !form.warehouseId) throw new Error("Selecciona un producto y un almacén.");
      const quantity = Number(form.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("La cantidad debe ser un entero mayor que cero.");
      const response = await fetch("/api/inventory-movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, quantity, reason: form.reason || null, referenceId: form.referenceId || null, notes: form.notes || null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar el movimiento");
      setSuccess("Movimiento registrado correctamente.");
      setForm((current) => ({ ...current, quantity: "", reason: "", referenceId: "", notes: "" }));
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Error registrando movimiento"); }
    finally { setSaving(false); }
  }

  const totals = useMemo(() => ({ entries: movements.filter((m) => m.type === "entry").length, exits: movements.filter((m) => m.type === "exit").length, adjustments: movements.filter((m) => m.type === "adjustment").length }), [movements]);

  return (
    <main className="mx-auto w-full max-w-7xl p-6">
      <div className="mb-6"><h1 className="text-2xl font-bold">Movimientos de inventario</h1><p className="mt-1 text-sm text-muted-foreground">Registra entradas, salidas y ajustes seleccionando datos reales de Stockly.</p></div>
      <form onSubmit={submit} className="mb-6 grid gap-3 rounded-xl border p-4 md:grid-cols-3">
        <select required disabled={optionsLoading || saving} value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className="rounded-lg border bg-background px-3 py-2 text-sm"><option value="">Selecciona producto</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ""}</option>)}</select>
        <select required disabled={optionsLoading || saving} value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} className="rounded-lg border bg-background px-3 py-2 text-sm"><option value="">Selecciona almacén</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        <select value={form.type} disabled={saving} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-lg border bg-background px-3 py-2 text-sm"><option value="entry">Entrada</option><option value="exit">Salida</option><option value="adjustment">Ajuste</option></select>
        <input required min="1" step="1" type="number" disabled={saving} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="Cantidad" className="rounded-lg border bg-background px-3 py-2 text-sm" />
        <input value={form.reason} disabled={saving} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Motivo" className="rounded-lg border bg-background px-3 py-2 text-sm" />
        <input value={form.referenceId} disabled={saving} onChange={(e) => setForm({ ...form, referenceId: e.target.value })} placeholder="Referencia (opcional)" className="rounded-lg border bg-background px-3 py-2 text-sm" />
        <input value={form.notes} disabled={saving} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas (opcional)" className="rounded-lg border bg-background px-3 py-2 text-sm md:col-span-2" />
        <button disabled={saving || optionsLoading || products.length === 0 || warehouses.length === 0} className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50">{saving ? "Guardando…" : optionsLoading ? "Cargando…" : "Registrar movimiento"}</button>
      </form>
      {success && <div className="mb-4 rounded-lg border p-3 text-sm">{success}</div>}
      {error && <div className="mb-4 rounded-lg border p-3 text-sm">{error}</div>}
      <div className="mb-6 grid gap-4 sm:grid-cols-3"><div className="rounded-xl border p-4"><div className="text-sm text-muted-foreground">Entradas</div><div className="mt-1 text-2xl font-semibold">{totals.entries}</div></div><div className="rounded-xl border p-4"><div className="text-sm text-muted-foreground">Salidas</div><div className="mt-1 text-2xl font-semibold">{totals.exits}</div></div><div className="rounded-xl border p-4"><div className="text-sm text-muted-foreground">Ajustes</div><div className="mt-1 text-2xl font-semibold">{totals.adjustments}</div></div></div>
      <div className="mb-4"><select className="rounded-lg border bg-background px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}><option value="all">Todos</option><option value="entry">Entradas</option><option value="exit">Salidas</option><option value="adjustment">Ajustes</option><option value="transfer_in">Transferencias de entrada</option><option value="transfer_out">Transferencias de salida</option></select></div>
      <div className="overflow-hidden rounded-xl border"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-muted/30"><tr><th className="px-4 py-3 text-left">Fecha</th><th className="px-4 py-3 text-left">Tipo</th><th className="px-4 py-3 text-right">Cantidad</th><th className="px-4 py-3 text-right">Anterior</th><th className="px-4 py-3 text-right">Nuevo</th><th className="px-4 py-3 text-left">Motivo</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="px-4 py-10 text-center">Cargando…</td></tr> : movements.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No hay movimientos todavía.</td></tr> : movements.map((m) => <tr key={m.id} className="border-b last:border-0"><td className="px-4 py-3">{new Date(m.createdAt).toLocaleString("es-CO")}</td><td className="px-4 py-3 font-medium">{labels[m.type] ?? m.type}</td><td className="px-4 py-3 text-right">{m.quantity}</td><td className="px-4 py-3 text-right">{m.previousStock}</td><td className="px-4 py-3 text-right font-medium">{m.newStock}</td><td className="px-4 py-3">{m.reason || "—"}</td></tr>)}</tbody></table></div></div>
    </main>
  );
}
