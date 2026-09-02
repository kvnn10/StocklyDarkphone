"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Smartphone } from "lucide-react";
import Link from "next/link";

type Option = { id: string; name: string };
const money = (v?: string) => Number(v || 0);

async function loadOptions(url: string): Promise<Option[]> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `No se pudieron cargar las opciones de ${url}`);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.categories)) return data.categories;
  if (Array.isArray(data?.suppliers)) return data.suppliers;
  if (Array.isArray(data?.warehouses)) return data.warehouses;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export default function DevicePurchasePage() {
  const [categories, setCategories] = useState<Option[]>([]), [suppliers, setSuppliers] = useState<Option[]>([]), [warehouses, setWarehouses] = useState<Option[]>([]);
  const [form, setForm] = useState<Record<string, string>>({ name: "", brand: "Apple", model: "", imei1: "", imei2: "", serial: "", clientName: "", phonePasscode: "", purchasePrice: "0", repairCost: "0", salePrice: "0", warrantyDays: "0", categoryId: "", supplierId: "", warehouseId: "", notes: "" });
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");
  useEffect(() => { Promise.all([loadOptions("/api/categories"), loadOptions("/api/suppliers"), loadOptions("/api/warehouses")]).then(([c, s, w]) => { setCategories(c); setSuppliers(s); setWarehouses(w); }).catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las opciones de inventario")).finally(() => setLoading(false)); }, []);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  async function submit(e: React.FormEvent) { e.preventDefault(); setSaving(true); setError(""); setDone(""); try { const r = await fetch("/api/devices/purchase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, purchasePrice: money(form.purchasePrice), repairCost: money(form.repairCost), salePrice: money(form.salePrice), warrantyDays: Number(form.warrantyDays) }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); setDone(`Compra registrada. SKU ${d.sku} · Orden ${d.purchaseOrderId}`); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar la compra"); } finally { setSaving(false); } }
  const input = (k: string, label: string, type = "text", required = false) => <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}{required ? " *" : ""}</span><input required={required} type={type} value={form[k] ?? ""} onChange={e => set(k, e.target.value)} className="h-10 w-full rounded-xl border bg-background px-3 text-sm" /></label>;
  if (loading) return <div className="p-8 text-sm text-muted-foreground">Cargando opciones...</div>;
  return <div className="min-h-screen p-4 sm:p-8"><div className="mx-auto max-w-4xl space-y-6"><Link href="/devices" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Volver a equipos</Link><div><div className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-violet-500" /><h1 className="text-2xl font-semibold">Comprar equipo usado</h1></div><p className="mt-1 text-sm text-muted-foreground">Crea el equipo, producto de inventario, entrada de stock y orden de compra en un solo flujo.</p></div>{error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}{done && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700">{done}</div>}<form onSubmit={submit} className="space-y-5 rounded-2xl border bg-background p-5 shadow-sm"><div className="grid gap-4 sm:grid-cols-2">{input("name", "Nombre interno", "text", true)}{input("brand", "Marca", "text", true)}{input("model", "Modelo", "text", true)}{input("clientName", "Vendedor / procedencia")}{input("imei1", "IMEI 1")}{input("imei2", "IMEI 2")}{input("serial", "Serial")}{input("phonePasscode", "Clave del teléfono (opcional)", "password")}{input("purchasePrice", "Precio de compra", "number", true)}{input("repairCost", "Costo de reparación", "number")}{input("salePrice", "Precio de venta", "number", true)}{input("warrantyDays", "Garantía (días)", "number")}</div><div className="grid gap-4 sm:grid-cols-3"><Select label="Categoría" value={form.categoryId ?? ""} onChange={v => set("categoryId", v)} options={categories} /><Select label="Proveedor" value={form.supplierId ?? ""} onChange={v => set("supplierId", v)} options={suppliers} /><Select label="Bodega" value={form.warehouseId ?? ""} onChange={v => set("warehouseId", v)} options={warehouses} /></div>{input("notes", "Notas")}<div className="flex justify-end"><button disabled={saving} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? "Registrando..." : "Registrar compra y entrar a inventario"}</button></div></form></div></div>;
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Option[] }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}{" *"}</span><select required value={value} onChange={e => onChange(e.target.value)} className="h-10 w-full rounded-xl border bg-background px-3 text-sm"><option value="">Seleccionar...</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>; }
