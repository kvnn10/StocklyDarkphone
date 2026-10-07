"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BatteryCharging, Layers, MapPin, Package, Plus, Save, ShieldCheck, Smartphone, X } from "lucide-react";
import { GlassCard, GlassCardBody, PageContentWrapper, SectionCountBadge, SectionTitleRow } from "@/components/shared";
import { productStockAvailableTextClass } from "@/lib/ui/semantic-badges";
import { cn } from "@/lib/utils";
import type { ProductVariantView } from "@/hooks/queries/use-product-variants";

type Props = { productId: string; initialVariants?: ProductVariantView[] };
type Warehouse = { id: string; name: string };
type DeviceTracking = { imei?: string | null; serial?: string | null; capacity?: string | null; color?: string | null; batteryHealth?: number | null; condition?: string | null; warrantyUntil?: string | null; notes?: string | null };
type DeviceForm = { name: string; sku: string; price: string; purchasePrice: string; imei: string; serial: string; capacity: string; color: string; batteryHealth: string; condition: string; warrantyUntil: string; notes: string; warehouseId: string };
const EMPTY_FORM: DeviceForm = { name: "", sku: "", price: "", purchasePrice: "", imei: "", serial: "", capacity: "", color: "", batteryHealth: "100", condition: "Usado", warrantyUntil: "", notes: "", warehouseId: "" };

function getDeviceTracking(variant: ProductVariantView): DeviceTracking | null {
  const attrs = variant.attributes;
  if (!attrs || typeof attrs !== "object") return null;
  const tracking = attrs.deviceTracking;
  if (!tracking || typeof tracking !== "object" || Array.isArray(tracking)) return null;
  return tracking as DeviceTracking;
}

export default function ProductVariantsSection({ productId, initialVariants = [] }: Props) {
  const [variants, setVariants] = useState<ProductVariantView[]>(initialVariants);
  const [loading, setLoading] = useState(initialVariants.length === 0);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [form, setForm] = useState<DeviceForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const loadVariants = async () => {
    const response = await fetch("/api/products/" + productId + "/variants", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudieron cargar las variantes");
    setVariants(await response.json() as ProductVariantView[]);
  };

  useEffect(() => {
    if (initialVariants.length > 0) return;
    let active = true;
    fetch("/api/products/" + productId + "/variants", { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("No se pudieron cargar las variantes"); return response.json() as Promise<ProductVariantView[]>; })
      .then((data) => { if (active) setVariants(data); })
      .catch(() => { if (active) setVariants([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId, initialVariants.length]);

  useEffect(() => {
    fetch("/api/warehouses", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : [])
      .then((data) => setWarehouses(Array.isArray(data) ? data : data?.warehouses ?? []))
      .catch(() => setWarehouses([]));
  }, []);

  useEffect(() => {
    const header = document.querySelector<HTMLElement>('[data-page-section-header="true"]');
    const shell = header?.parentElement;
    if (!header || !shell) return;
    const target = document.createElement("div");
    target.setAttribute("data-product-variants-slot", productId);
    target.className = "min-w-0 w-full";
    shell.insertBefore(target, header.nextSibling);
    setPortalTarget(target);
    return () => { setPortalTarget(null); target.remove(); };
  }, [productId]);

  const submitDevice = async () => {
    setFormError("");
    if (!form.name.trim() || !form.sku.trim()) return setFormError("El nombre del equipo y el SKU son obligatorios.");
    if (!form.imei.trim() && !form.serial.trim()) return setFormError("Registra al menos el IMEI o el serial para identificar el equipo.");
    if (!form.warehouseId) return setFormError("Selecciona la bodega donde quedará el equipo.");
    setSaving(true);
    try {
      const response = await fetch("/api/products/" + productId + "/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(), sku: form.sku.trim(), price: Number(form.price) || 0, purchasePrice: Number(form.purchasePrice) || 0,
          initialQuantity: 1, warehouseId: form.warehouseId,
          deviceTracking: {
            imei: form.imei.trim() || undefined, serial: form.serial.trim() || undefined, capacity: form.capacity.trim() || undefined,
            color: form.color.trim() || undefined, batteryHealth: form.batteryHealth === "" ? undefined : Number(form.batteryHealth),
            condition: form.condition || undefined, warrantyUntil: form.warrantyUntil || undefined, notes: form.notes.trim() || undefined,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || "No se pudo registrar el equipo.");
      await loadVariants();
      setForm(EMPTY_FORM);
      setShowDeviceForm(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo registrar el equipo.");
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <PageContentWrapper>
      <div className="w-full pb-6">
        <GlassCard variant="violet">
          <GlassCardBody className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <SectionTitleRow as="h3" icon={Layers} iconClassName="text-violet-600 dark:text-violet-400" iconTile title="Equipos / unidades" trailing={!loading ? <SectionCountBadge>{variants.length} registrados</SectionCountBadge> : undefined} subtitle="Identifica cada equipo de DarkPhone por IMEI, serial y estado." />
              <button type="button" onClick={() => { setFormError(""); setShowDeviceForm((value) => !value); }} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/15 px-4 text-sm font-medium text-rose-700 transition hover:bg-rose-500/25 dark:text-rose-200">
                {showDeviceForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {showDeviceForm ? "Cancelar" : "Registrar equipo"}
              </button>
            </div>

            {showDeviceForm && (
              <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/[0.04] p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white"><Smartphone className="h-4 w-4 text-rose-500" />Datos del equipo</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["name", "Equipo / variante", "Ej. iPhone 15 Pro 256GB"],
                    ["sku", "SKU del equipo", "Ej. IP15P256-NAT-01"],
                    ["imei", "IMEI", "15 dígitos"],
                    ["serial", "Serial", "Número de serie"],
                    ["capacity", "Capacidad", "128 GB / 256 GB / 1 TB"],
                    ["color", "Color", "Natural Titanium"],
                    ["purchasePrice", "Costo de compra", "0"],
                    ["price", "Precio de venta", "0"],
                    ["warrantyUntil", "Garantía hasta", ""],
                    ["notes", "Notas", "Observaciones del equipo"],
                  ].map(([key, label, placeholder]) => (
                    <label key={key} className={key === "notes" ? "sm:col-span-2 lg:col-span-4" : ""}>
                      <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-white/70">{label}</span>
                      <input type={key === "warrantyUntil" ? "date" : (key === "purchasePrice" || key === "price") ? "number" : "text"} value={form[key as keyof DeviceForm] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} min={(key === "purchasePrice" || key === "price") ? "0" : undefined} className="h-10 w-full rounded-xl border border-violet-300/20 bg-white/70 px-3 text-sm outline-none placeholder:text-gray-400 focus:border-rose-400/50 dark:bg-white/5 dark:text-white dark:placeholder:text-white/35" />
                    </label>
                  ))}
                  <label><span className="mb-1 block text-xs font-medium text-gray-600 dark:text-white/70">Salud de batería</span><div className="relative"><BatteryCharging className="absolute left-3 top-3 h-4 w-4 text-emerald-500" /><input type="number" min="0" max="100" value={form.batteryHealth} onChange={(event) => setForm((current) => ({ ...current, batteryHealth: event.target.value }))} className="h-10 w-full rounded-xl border border-violet-300/20 bg-white/70 pl-9 pr-10 text-sm dark:bg-white/5 dark:text-white" /><span className="absolute right-3 top-2.5 text-sm text-gray-500">%</span></div></label>
                  <label><span className="mb-1 block text-xs font-medium text-gray-600 dark:text-white/70">Condición</span><select value={form.condition} onChange={(event) => setForm((current) => ({ ...current, condition: event.target.value }))} className="h-10 w-full rounded-xl border border-violet-300/20 bg-white/70 px-3 text-sm dark:bg-slate-900 dark:text-white"><option>Nuevo</option><option>Usado</option><option>Refurbished</option><option>Para reparación</option></select></label>
                  <label><span className="mb-1 block text-xs font-medium text-gray-600 dark:text-white/70">Bodega</span><select value={form.warehouseId} onChange={(event) => setForm((current) => ({ ...current, warehouseId: event.target.value }))} className="h-10 w-full rounded-xl border border-violet-300/20 bg-white/70 px-3 text-sm dark:bg-slate-900 dark:text-white"><option value="">Seleccionar bodega</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
                </div>
                {formError && <p className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200" role="alert">{formError}</p>}
                <div className="mt-4 flex justify-end"><button type="button" disabled={saving} onClick={submitDevice} className="inline-flex h-10 items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white shadow-lg shadow-rose-500/20 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Guardando…" : "Guardar equipo"}</button></div>
              </div>
            )}

            {loading ? (
              <div className="mt-4 rounded-xl border border-violet-200/20 bg-white/5 p-4 text-sm text-muted-foreground">Cargando equipos…</div>
            ) : variants.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-violet-300/20 bg-white/[0.03] p-5 text-sm text-muted-foreground">Registra el primer equipo para empezar a controlar IMEI, serial, batería y garantía.</div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {variants.map((variant) => {
                  const available = Math.max(0, variant.quantity - variant.reservedQuantity);
                  const stockRows = variant.stocks.filter((stock) => stock.quantity - stock.reservedQuantity > 0);
                  const device = getDeviceTracking(variant);
                  return (
                    <div key={variant.id} className="group flex min-h-[190px] min-w-0 flex-col rounded-xl border border-violet-300/20 bg-violet-500/[0.045] p-3 transition-colors hover:border-violet-300/35 hover:bg-violet-500/[0.07]">
                      <div className="flex min-w-0 items-start justify-between gap-2"><div className="min-w-0"><p className="flex items-center gap-1.5 truncate text-sm font-medium text-gray-800 dark:text-white"><Package className="h-3.5 w-3.5 shrink-0 text-violet-400" /><span className="truncate">{variant.name}</span></p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{variant.sku}</p></div><div className="shrink-0 text-right"><p className={cn("text-base font-bold leading-none", productStockAvailableTextClass(available))}>{available}</p><p className="mt-0.5 text-[10px] text-muted-foreground">disponible</p></div></div>
                      {device && <div className="mt-3 space-y-1.5 text-[11px]"><div className="grid grid-cols-2 gap-1.5">{device.imei && <span className="truncate rounded-lg bg-white/50 px-2 py-1 font-mono text-gray-700 dark:bg-white/5 dark:text-white/75">IMEI {device.imei}</span>}{device.serial && <span className="truncate rounded-lg bg-white/50 px-2 py-1 font-mono text-gray-700 dark:bg-white/5 dark:text-white/75">SN {device.serial}</span>}{device.capacity && <span>Capacidad: {device.capacity}</span>}{device.color && <span>Color: {device.color}</span>}</div><div className="flex flex-wrap gap-1.5">{device.batteryHealth != null && <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300"><BatteryCharging className="h-3 w-3" />{device.batteryHealth}% batería</span>}{device.condition && <span className="rounded-full bg-violet-500/10 px-2 py-0.5">{device.condition}</span>}{device.warrantyUntil && <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><ShieldCheck className="h-3 w-3" />Garantía {device.warrantyUntil}</span>}</div></div>}
                      <div className="mt-auto flex min-w-0 flex-wrap items-end justify-between gap-2 pt-3"><div className="min-w-0 text-[10px] leading-4 text-muted-foreground"><span>Costo {variant.purchasePrice.toFixed(2)}</span><span className="mx-1">·</span><span>Venta {variant.price.toFixed(2)}</span></div>{stockRows.length > 0 ? <div className="flex min-w-0 shrink-0 flex-wrap justify-end gap-1">{stockRows.map((stock) => <span key={stock.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-teal-300/20 bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-700 dark:text-teal-200" title={stock.warehouseName}><MapPin className="h-3 w-3 shrink-0" />{stock.warehouseName}: {Math.max(0, stock.quantity - stock.reservedQuantity)}</span>)}</div> : <span className="shrink-0 text-[10px] text-muted-foreground">Sin bodega</span>}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCardBody>
        </GlassCard>
      </div>
    </PageContentWrapper>
  );

  return portalTarget ? createPortal(content, portalTarget) : null;
}
