"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Brain, Clock3, PackageSearch, ShoppingCart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Recommendation = { id: string; name: string; sku: string; stock: number; sold30d: number; daysCover: number | null; marginPct: number; priority: "critical" | "reorder" | "slow"; reason: string; suggestedQty: number };
type Data = { summary: { inventoryCost: number; inventoryRetail: number; potentialMargin: number; critical: number; reorder: number; slow: number }; recommendations: Recommendation[] };
const money = (v: number) => `$${Math.round(v || 0).toLocaleString("es-CO")}`;

export default function InventoryIntelligenceCard() {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => { let active = true; fetch("/api/dashboard/inventory-intelligence", { credentials: "include", cache: "no-store" }).then(r => r.ok ? r.json() : null).then(v => { if (active && v) setData(v); }).catch(() => undefined); return () => { active = false; }; }, []);
  return <Card className="overflow-hidden">
    <CardHeader className="flex-row items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5" /> Inventario inteligente</CardTitle><p className="mt-1 text-sm text-muted-foreground">Stockly detecta qué reponer y dónde tienes capital inmovilizado.</p></div><Link href="/admin/products" className="inline-flex items-center gap-1 text-sm font-medium hover:underline">Ver inventario <ArrowRight className="h-4 w-4" /></Link></CardHeader>
    <CardContent>{!data ? <div className="grid gap-3 sm:grid-cols-3"><div className="h-20 animate-pulse rounded-xl border bg-muted/20"/><div className="h-20 animate-pulse rounded-xl border bg-muted/20"/><div className="h-20 animate-pulse rounded-xl border bg-muted/20"/></div> : <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Mini icon={PackageSearch} label="Invertido" value={money(data.summary.inventoryCost)} /><Mini icon={ShoppingCart} label="Valor venta" value={money(data.summary.inventoryRetail)} /><Mini icon={Brain} label="Utilidad potencial" value={money(data.summary.potentialMargin)} positive /><Mini icon={AlertTriangle} label="Críticos" value={String(data.summary.critical)} alert={data.summary.critical > 0} /><Mini icon={Clock3} label="Lentos" value={String(data.summary.slow)} /></div>
      {data.recommendations.length > 0 && <div className="mt-4 space-y-2">{data.recommendations.slice(0, 5).map(r => <div key={r.id} className="flex items-center gap-3 rounded-xl border p-3"><div className={`h-2.5 w-2.5 rounded-full ${r.priority === "critical" ? "bg-red-500" : r.priority === "reorder" ? "bg-amber-500" : "bg-slate-400"}`} /><div className="min-w-0 flex-1"><div className="truncate font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.reason} · Stock: {r.stock} · 30d: {r.sold30d}</div></div>{r.suggestedQty > 0 && <span className="rounded-lg bg-muted px-2 py-1 text-xs font-semibold">Comprar {r.suggestedQty}</span>}</div>)}</div>}
      {data.recommendations.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No hay alertas inteligentes de inventario en este momento.</p>}
    </>}</CardContent>
  </Card>;
}
function Mini({ icon: Icon, label, value, positive, alert }: { icon: typeof Brain; label: string; value: string; positive?: boolean; alert?: boolean }) { return <div className="rounded-xl border bg-muted/20 p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4"/><span>{label}</span></div><div className={`mt-2 text-lg font-semibold ${positive ? "text-emerald-600 dark:text-emerald-400" : alert ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div></div>; }
