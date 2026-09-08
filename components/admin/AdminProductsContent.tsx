"use client";

import React, { useMemo, useState } from "react";
import ProductList from "@/components/products/ProductList";
import { PageContentWrapper } from "@/components/shared";
import FloatingActionButtons from "@/components/shared/FloatingActionButtons";
import { useProducts } from "@/hooks/queries";
import { useAuth } from "@/contexts";
import type { ProductForHome } from "@/lib/server/home-data";
import type { DashboardStats, SupplierPortalDashboard } from "@/types";

type ImportRow = {
  product: string;
  variant: string;
  sku: string;
  quantity: number;
  purchasePrice: number;
  price: number;
  warehouse: string;
  category: string;
};

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-CO")}`;
const parseMoney = (value: string) => {
  const n = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? (/[mk]/i.test(value) ? n * 1000 : n) : 0;
};

const colors = "negra|negro|azul|azules|blanca|blanco|natural|dorada|dorado|verde|roja|rojo|morada|morado|rosa|rosado|rosada|gris|plateada|plateado|amarilla|amarillo|espacial|grafito|pacífico|pacifico|alpino|medianoche|estrella|plata|oro";
const colorPattern = new RegExp(`^(${colors})(?:\\s+(?:espacial|grafito|pacífico|pacifico|alpino|estrella|noche))?$`, "i");
const modelPattern = /^(?:iPhone\s+)(.+?)\s*:?$/i;

function normalizeVariant(value: string) {
  return value
    .replace(/^[*•\-–—]+\s*/, "")
    .replace(/[📱📲]/g, "")
    .replace(/[.;:]\s*$/, "")
    .trim();
}

function isVariantLine(value: string) {
  const normalized = normalizeVariant(value).toLowerCase();
  if (colorPattern.test(normalized)) return true;
  return new RegExp(`^(?:\\d+)\\s*(?:unidades?\\s*)?(?:de\\s*)?(${colors})\\b`, "i").test(normalized);
}

function parsePrice(text: string, kind: "cost" | "sale") {
  const pattern = kind === "sale"
    ? /(?:venta|vendo|vender(?:é)?|precio de venta)\s*(?:a|en|de)?\s*\$?\s*([\d.,]+)\s*(mil|k)?/i
    : /(?:costo|coste|me cost(?:ó|o)|compr(?:é|e))\s*(?:a|de)?\s*\$?\s*([\d.,]+)\s*(mil|k)?(?:\s*(?:cada|c\/u|unidad))?/i;
  const match = text.match(pattern);
  return match?.[1] ? parseMoney(match[1] + (match[2] || "")) : 0;
}

function parseText(text: string, defaultWarehouse: string, defaultCategory: string): ImportRow[] {
  const rows: ImportRow[] = [];
  const lines = text.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const textCategory = text.match(/(?:^|\n)\s*categor[ií]a\s*:\s*(.+?)\s*$/im)?.[1]?.trim() || "";
  const textWarehouse = text.match(/(?:^|\n)\s*bodega\s*:\s*(.+?)\s*$/im)?.[1]?.trim() || "";
  const category = defaultCategory.trim() || textCategory || "";
  const warehouse = defaultWarehouse.trim() || textWarehouse || "Darkphone";
  const eachMatch = text.match(/\b(\d+)\s+de\s+cada\s+uno\b/i);
  const eachQuantity = eachMatch?.[1] ? Number(eachMatch[1]) : null;
  const globalSale = parsePrice(text, "sale");
  const globalCost = parsePrice(text, "cost");

  let currentProduct = "";

  for (const raw of lines) {
    const cleanLine = raw.replace(/^[📱📲\s]*/, "").trim();
    if (/^(?:lista|categor[ií]a|bodega)\s*:/i.test(cleanLine)) continue;
    if (/\bde\s+cada\s+uno\b/i.test(cleanLine)) continue;

    const header = cleanLine.match(modelPattern);
    if (header && !isVariantLine(cleanLine)) {
      const candidate = header[1].trim();
      if (/^\d{1,2}(?:\s+(?:pro\s+max|pro|plus|max))?(?:\s+mini)?$/i.test(candidate) || /^(?:x|xs|xs\s+max|se|xr|11|12|13|14|15|16|17)(?:\s+(?:pro\s+max|pro|plus|max|mini))?$/i.test(candidate)) {
        currentProduct = `iPhone ${candidate}`;
        continue;
      }
    }

    const sale = parsePrice(cleanLine, "sale") || globalSale;
    const cost = parsePrice(cleanLine, "cost") || globalCost;
    const withoutPrices = cleanLine
      .replace(/(?:venta|vendo|vender(?:é)?|precio de venta)\s*(?:a|en|de)?\s*\$?\s*[\d.,]+\s*(?:mil|k)?/ig, "")
      .replace(/(?:costo|coste|me cost(?:ó|o)|compr(?:é|e))\s*(?:a|de)?\s*\$?\s*[\d.,]+\s*(?:mil|k)?(?:\s*(?:cada|c\/u|unidad))?/ig, "")
      .replace(/\ba\s*\$?\s*[\d.,]+\s*(?:mil|k)\s*(?:cada|c\/u|unidad)?/ig, "")
      .trim();

    // Formato agrupado por modelo:
    // iPhone 11
    // * Negro
    // * Verde
    // * Amarillo
    if (currentProduct && isVariantLine(withoutPrices)) {
      const variantMatch = withoutPrices.match(/^(?:([0-9]+)\s*(?:unidades?\s*)?(?:de\s*)?)?(.+?)$/i);
      if (variantMatch?.[2]) {
        const variant = normalizeVariant(variantMatch[2]);
        const quantity = Number(variantMatch[1] || eachQuantity || 1);
        if (variant && quantity > 0) {
          rows.push({ product: currentProduct, variant, sku: "", quantity, purchasePrice: cost, price: sale, warehouse, category });
          continue;
        }
      }
    }

    // Formato "iPhone 15 Pro: negra, azul..." o varias cantidades de color.
    const inlineModel = withoutPrices.match(/^(?:[📱📲]\s*)?(iPhone\s+.+?)\s*[:\-]\s*(.+)$/i);
    if (inlineModel?.[1] && inlineModel[2]) {
      const product = inlineModel[1].trim();
      const parts = inlineModel[2].split(/\s*(?:,|;|\by\b)\s*/i).map((part) => part.trim()).filter(Boolean);
      for (const part of parts) {
        const match = part.match(/^(\d+)\s*(?:unidades?\s*)?(?:de\s*)?(.+)$/i);
        const quantity = Number(match?.[1] || eachQuantity || 1);
        const variant = normalizeVariant(match?.[2] || part);
        if (variant && quantity > 0) rows.push({ product, variant, sku: "", quantity, purchasePrice: cost, price: sale, warehouse, category });
      }
      continue;
    }

    // Formato libre anterior: "6 tapas iPhone 16 Pro Max negras, 5 naturales y 4 doradas".
    const variantPattern = new RegExp(`(\\d+)\\s*(?:unidades?\\s*)?(?:de\\s*)?(${colors}(?:\\s+(?:espacial|grafito|pacífico|pacifico|alpino|estrella|noche))?)\\b`, "gi");
    const variants = [...withoutPrices.matchAll(variantPattern)];
    if (variants.length >= 2) {
      const first = variants[0];
      if (!first) continue;
      const prefix = withoutPrices.slice(0, first.index ?? 0).replace(/[,;:]\s*$/, "").replace(/^(?:tengo|compr[eé]|llegaron|agreg[aá]r?)\s+/i, "").trim();
      for (const match of variants) {
        const variant = match[2] || "";
        const quantity = Number(match[1] || 0);
        if (variant && quantity > 0) rows.push({ product: prefix || "Producto", variant, sku: "", quantity, purchasePrice: cost, price: sale, warehouse, category });
      }
      continue;
    }

    // "1 de cada uno" con modelos escritos como "15 Pro" / "17 Pro Max".
    if (eachQuantity !== null) {
      const model = withoutPrices.match(/^(?:iPhone\s*)?((?:x|xs|xr|se|\d{1,2})(?:\s+(?:pro\s+max|pro|plus|max|mini))?)\b(.*)$/i);
      if (model?.[1]) {
        const product = `iPhone ${model[1].trim()}`;
        const detail = (model[2] || "").replace(/^[,;:\-]+\s*/, "").trim();
        rows.push({ product, variant: detail, sku: "", quantity: eachQuantity, purchasePrice: cost, price: sale, warehouse, category });
        continue;
      }
    }

    const match = withoutPrices.match(/^(?:.*?)(\d+)\s*(?:unidades?\s*)?(?:de\s*)?(.+?)\s*$/i);
    if (!match?.[1] || !match?.[2]) continue;
    const quantity = Number(match[1]);
    let product = match[2].replace(/[,;.]\s*$/, "").trim();
    const variantMatch = product.match(new RegExp(`^(.*?)(?:\\s+)(${colors}(?:\\s+(?:espacial|grafito|pacífico|pacifico|alpino|estrella|noche))?)$`, "i"));
    const variant = variantMatch?.[2] || "";
    if (variantMatch?.[1]) product = variantMatch[1].trim();
    if (product && quantity > 0) rows.push({ product, variant, sku: "", quantity, purchasePrice: cost, price: sale, warehouse, category });
  }

  return rows.filter((r) => r.product && r.quantity > 0);
}

export type AdminProductsContentProps = { initialProducts?: ProductForHome[]; initialStats?: DashboardStats; initialSupplierPortal?: SupplierPortalDashboard | null };

export default function AdminProductsContent({ initialProducts, initialStats, initialSupplierPortal }: AdminProductsContentProps = {}) {
  const { data: allProducts = [], refetch } = useProducts(initialProducts);
  const { user } = useAuth();
  const [showImporter, setShowImporter] = useState(false), [text, setText] = useState(""), [warehouse, setWarehouse] = useState("Darkphone"), [category, setCategory] = useState(""), [rows, setRows] = useState<ImportRow[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState("");

  const preview = () => {
    const parsed = parseText(text, warehouse, category);
    if (!parsed.length) { setError("No pude identificar productos. Puedes pegar una lista por modelo, por ejemplo “iPhone 11” seguido de sus colores en líneas separadas."); return; }
    setError(parsed.some((r) => !r.purchasePrice || !r.price || !r.category) ? "Falta categoría, costo o precio de venta en una o más líneas. Puedes completarlos en la tabla." : "");
    setRows(parsed);
  };
  const update = (i: number, key: keyof ImportRow, value: string) => setRows((prev) => prev.map((r, index) => index === i ? { ...r, [key]: ["quantity", "purchasePrice", "price"].includes(key) ? Number(value) : value } : r));
  const remove = (i: number) => setRows((prev) => prev.filter((_, index) => index !== i));
  const totals = useMemo(() => rows.reduce((a, r) => ({ units: a.units + Number(r.quantity || 0), cost: a.cost + Number(r.quantity || 0) * Number(r.purchasePrice || 0), sales: a.sales + Number(r.quantity || 0) * Number(r.price || 0) }), { units: 0, cost: 0, sales: 0 }), [rows]);

  const confirmImport = async () => {
    if (!rows.length || loading) return;
    if (rows.some((r) => !r.product || !r.quantity || !r.purchasePrice || !r.price || !r.category)) { setError("Completa nombre, categoría, cantidad, costo y venta antes de confirmar."); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/products/bulk-tapas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar el inventario.");
      await refetch(); setRows([]); setText(""); setShowImporter(false);
      window.alert(`✅ Inventario cargado.\n\n${data.units} unidades\nCosto: ${money(data.totalCost)}\nVenta potencial: ${money(data.potentialSales)}\nUtilidad potencial: ${money(data.potentialSales - data.totalCost)}`);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar el inventario."); } finally { setLoading(false); }
  };

  return <PageContentWrapper>
    <div className="mb-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Carga masiva inteligente</h2><p className="text-sm text-muted-foreground">Escribe cómo compraste el inventario y Stockly lo convierte en productos y variantes.</p></div><button type="button" onClick={() => { setShowImporter(true); setError(""); }} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Nuevo lote</button></div>
      {showImporter && <div className="mt-4 rounded-xl border bg-background p-4">{!rows.length ? <><div className="mb-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Bodega<input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="mt-1 w-full rounded-lg border bg-card px-3 py-2" /></label><label className="text-sm">Categoría (obligatoria)<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ej. Cocos, Baterías, Tapas, Displays" className="mt-1 w-full rounded-lg border bg-card px-3 py-2" /></label></div><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'Ejemplo:\nCategoría: Tapas\n\niPhone 11\n* Negro\n* Verde\n* Amarillo\n\niPhone 12 Pro\n* Gris grafito\n* Plata\n* Oro\n\nCosto: 15 mil cada una\nVenta: 50 mil'} className="min-h-[170px] w-full rounded-xl border bg-card p-3 text-sm outline-none focus:ring-2" />{error && <p className="mt-2 text-sm text-destructive">{error}</p>}<div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setShowImporter(false)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button type="button" onClick={preview} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Convertir y revisar</button></div></> : <><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Revisa antes de agregar</h3><p className="text-xs text-muted-foreground">Nada se ha guardado todavía. Puedes modificar cualquier campo.</p></div><button type="button" onClick={() => setRows([])} className="text-sm underline">Volver al texto</button></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Producto</th><th className="p-2">Detalle / variante</th><th className="p-2">SKU</th><th className="p-2">Cant.</th><th className="p-2">Costo</th><th className="p-2">Venta</th><th className="p-2">Bodega</th><th className="p-2">Categoría</th><th /></tr></thead><tbody>{rows.map((r, i) => <tr key={i} className="border-b"><td className="p-1"><input value={r.product} onChange={(e) => update(i, "product", e.target.value)} className="w-52 rounded border bg-card px-2 py-1" /></td><td className="p-1"><input value={r.variant} onChange={(e) => update(i, "variant", e.target.value)} placeholder="—" className="w-36 rounded border bg-card px-2 py-1" /></td><td className="p-1"><input value={r.sku} onChange={(e) => update(i, "sku", e.target.value)} placeholder="Automático" className="w-32 rounded border bg-card px-2 py-1" /></td><td className="p-1"><input type="number" min="1" value={r.quantity} onChange={(e) => update(i, "quantity", e.target.value)} className="w-20 rounded border bg-card px-2 py-1" /></td><td className="p-1"><input type="number" min="0" value={r.purchasePrice} onChange={(e) => update(i, "purchasePrice", e.target.value)} className="w-28 rounded border bg-card px-2 py-1" /></td><td className="p-1"><input type="number" min="0" value={r.price} onChange={(e) => update(i, "price", e.target.value)} className="w-28 rounded border bg-card px-2 py-1" /></td><td className="p-1"><input value={r.warehouse} onChange={(e) => update(i, "warehouse", e.target.value)} className="w-28 rounded border bg-card px-2 py-1" /></td><td className="p-1"><input value={r.category} onChange={(e) => update(i, "category", e.target.value)} className="w-28 rounded border bg-card px-2 py-1" /></td><td className="p-1"><button type="button" onClick={() => remove(i)} className="px-2 text-muted-foreground hover:text-destructive">×</button></td></tr>)}</tbody></table></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-lg border p-3"><span className="text-xs text-muted-foreground">Unidades</span><div className="font-semibold">{totals.units}</div></div><div className="rounded-lg border p-3"><span className="text-xs text-muted-foreground">Inversión</span><div className="font-semibold">{money(totals.cost)}</div></div><div className="rounded-lg border p-3"><span className="text-xs text-muted-foreground">Venta potencial / utilidad</span><div className="font-semibold">{money(totals.sales)} / {money(totals.sales - totals.cost)}</div></div></div>{error && <p className="mt-2 text-sm text-destructive">{error}</p>}<div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setShowImporter(false)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button type="button" onClick={confirmImport} disabled={loading} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{loading ? "Agregando…" : "Confirmar y agregar al inventario"}</button></div></>}</div>}
    </div>
    <ProductList initialProducts={initialProducts} initialStats={initialStats} initialSupplierPortal={initialSupplierPortal} />
    <FloatingActionButtons variant="products" allProducts={allProducts} userId={user?.id || ""} />
  </PageContentWrapper>;
}
