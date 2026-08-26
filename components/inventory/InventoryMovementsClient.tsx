"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRightLeft, CheckCircle2, CircleArrowDown, CircleArrowUp, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import Navbar from "@/components/layouts/Navbar";
import { PageContentWrapper } from "@/components/shared";

type Movement = { id: string; productId: string; warehouseId: string; type: string; quantity: string; previousStock: string; newStock: string; reason: string | null; referenceId: string | null; notes: string | null; createdAt: string };
type Product = { id: string; name: string; sku?: string | null; quantity?: number | string };
type Warehouse = { id: string; name: string; status?: boolean };

const labels: Record<string, string> = { entry: "Entrada", exit: "Salida", adjustment: "Ajuste", transfer_in: "Transferencia entrada", transfer_out: "Transferencia salida" };
const typeStyles: Record<string, string> = {
  entry: "border-emerald-400/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  exit: "border-rose-400/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
  adjustment: "border-amber-400/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  transfer_in: "border-sky-400/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  transfer_out: "border-violet-400/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
};

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

  async function load(): Promise<Movement[]> {
    setLoading(true); setError("");
    try {
      const query = type === "all" ? "" : `?type=${encodeURIComponent(type)}`;
      const response = await fetch(`/api/inventory-movements${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar los movimientos");
      const next = Array.isArray(data) ? data as Movement[] : [];
      setMovements(next);
      return next;
    } catch (err) { setError(err instanceof Error ? err.message : "Error cargando movimientos"); return []; }
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
          setProducts(nextProducts); setWarehouses(nextWarehouses);
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
      const created = data as Movement;
      setSuccess("Movimiento registrado correctamente.");
      setForm((current) => ({ ...current, quantity: "", reason: "", referenceId: "", notes: "" }));
      const refreshed = await load();
      if (!refreshed.some((movement) => movement.id === created.id)) setMovements((current) => [created, ...current.filter((movement) => movement.id !== created.id)]);
    } catch (err) { setError(err instanceof Error ? err.message : "Error registrando movimiento"); }
    finally { setSaving(false); }
  }

  async function removeMovement(movement: Movement) {
    if (movement.type === "transfer_in" || movement.type === "transfer_out") {
      setError("Las transferencias no se eliminan desde aquí. Deben revertirse desde el movimiento de transferencia para mantener ambos almacenes sincronizados.");
      return;
    }
    if (!window.confirm("¿Quieres eliminar este movimiento y revertir su efecto sobre el stock?")) return;
    setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/inventory-movements?id=${encodeURIComponent(movement.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar el movimiento");
      setSuccess("Movimiento eliminado y stock revertido correctamente.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Error eliminando movimiento"); }
  }

  const totals = useMemo(() => ({ entries: movements.filter((m) => m.type === "entry").length, exits: movements.filter((m) => m.type === "exit").length, adjustments: movements.filter((m) => m.type === "adjustment").length, transfers: movements.filter((m) => m.type === "transfer_in" || m.type === "transfer_out").length }), [movements]);

  return (
    <Navbar>
      <PageContentWrapper className="w-full">
        <div className="mx-auto w-full max-w-7xl px-2 pb-8 sm:px-0">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><ArrowRightLeft className="h-4 w-4 text-sky-500" /> Inventario</div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Movimientos de inventario</h1>
              <p className="mt-1 text-sm text-muted-foreground">Registra y consulta entradas, salidas, ajustes y transferencias reales de Stockly.</p>
            </div>
            <Link href="/" className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-500/20 dark:text-sky-300"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
          </div>

          <form onSubmit={submit} className="mb-6 grid gap-3 rounded-2xl border border-white/10 bg-white/60 p-4 shadow-lg backdrop-blur-xl dark:bg-white/[0.04] md:grid-cols-3">
            <select required disabled={optionsLoading || saving} value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className="rounded-lg border bg-background px-3 py-2 text-sm"><option value="">Selecciona producto</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ""}</option>)}</select>
            <select required disabled={optionsLoading || saving} value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} className="rounded-lg border bg-background px-3 py-2 text-sm"><option value="">Selecciona almacén</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            <select value={form.type} disabled={saving} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-lg border bg-background px-3 py-2 text-sm"><option value="entry">Entrada</option><option value="exit">Salida</option><option value="adjustment">Ajuste</option></select>
            <input required min="1" step="1" type="number" disabled={saving} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="Cantidad" className="rounded-lg border bg-background px-3 py-2 text-sm" />
            <input value={form.reason} disabled={saving} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Motivo" className="rounded-lg border bg-background px-3 py-2 text-sm" />
            <input value={form.referenceId} disabled={saving} onChange={(e) => setForm({ ...form, referenceId: e.target.value })} placeholder="Referencia (opcional)" className="rounded-lg border bg-background px-3 py-2 text-sm" />
            <input value={form.notes} disabled={saving} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas (opcional)" className="rounded-lg border bg-background px-3 py-2 text-sm md:col-span-2" />
            <button disabled={saving || optionsLoading || products.length === 0 || warehouses.length === 0} className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:opacity-50">{saving ? "Guardando…" : optionsLoading ? "Cargando…" : "Registrar movimiento"}</button>
          </form>

          {success && <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{success}</div>}
          {error && <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</div>}

          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 p-4 shadow-lg"><div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CircleArrowDown className="h-4 w-4" /> Entradas</div><div className="mt-2 text-3xl font-bold">{totals.entries}</div></div>
            <div className="rounded-2xl border border-rose-400/20 bg-gradient-to-br from-rose-500/15 to-rose-500/5 p-4 shadow-lg"><div className="flex items-center gap-2 text-sm text-rose-700 dark:text-rose-300"><CircleArrowUp className="h-4 w-4" /> Salidas</div><div className="mt-2 text-3xl font-bold">{totals.exits}</div></div>
            <div className="rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/15 to-amber-500/5 p-4 shadow-lg"><div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300"><SlidersHorizontal className="h-4 w-4" /> Ajustes</div><div className="mt-2 text-3xl font-bold">{totals.adjustments}</div></div>
            <div className="rounded-2xl border border-sky-400/20 bg-gradient-to-br from-sky-500/15 to-violet-500/5 p-4 shadow-lg"><div className="flex items-center gap-2 text-sm text-sky-700 dark:text-sky-300"><ArrowRightLeft className="h-4 w-4" /> Transferencias</div><div className="mt-2 text-3xl font-bold">{totals.transfers}</div></div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3"><select className="rounded-lg border bg-background px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}><option value="all">Todos</option><option value="entry">Entradas</option><option value="exit">Salidas</option><option value="adjustment">Ajustes</option><option value="transfer_in">Transferencias de entrada</option><option value="transfer_out">Transferencias de salida</option></select><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{loading ? "Actualizando…" : "Actualizar historial"}</button></div>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/60 shadow-xl backdrop-blur-xl dark:bg-white/[0.04]">
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="border-b bg-gradient-to-r from-sky-500/10 via-violet-500/10 to-rose-500/10"><tr><th className="px-4 py-3 text-left">Fecha</th><th className="px-4 py-3 text-left">Tipo</th><th className="px-4 py-3 text-right">Cantidad</th><th className="px-4 py-3 text-right">Anterior</th><th className="px-4 py-3 text-right">Nuevo</th><th className="px-4 py-3 text-left">Motivo</th><th className="px-4 py-3 text-right">Acción</th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="px-4 py-10 text-center">Cargando…</td></tr> : movements.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No hay movimientos todavía.</td></tr> : movements.map((m) => <tr key={m.id} className="border-b last:border-0 hover:bg-sky-500/5"><td className="px-4 py-3 whitespace-nowrap">{new Date(m.createdAt).toLocaleString("es-CO")}</td><td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${typeStyles[m.type] ?? "border-border bg-muted text-muted-foreground"}`}>{labels[m.type] ?? m.type}</span></td><td className="px-4 py-3 text-right font-medium">{m.quantity}</td><td className="px-4 py-3 text-right">{m.previousStock}</td><td className="px-4 py-3 text-right font-semibold">{m.newStock}</td><td className="px-4 py-3">{m.reason || "—"}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => void removeMovement(m)} disabled={m.type === "transfer_in" || m.type === "transfer_out"} title={m.type.startsWith("transfer_") ? "Revierte la transferencia completa desde Almacenes" : "Eliminar y revertir"} className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-300"><Trash2 className="h-3.5 w-3.5" /> Eliminar</button></td></tr>)}</tbody></table></div>
          </div>
        </div>
      </PageContentWrapper>
    </Navbar>
  );
}
