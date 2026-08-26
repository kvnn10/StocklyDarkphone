"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleDollarSign, TrendingUp, Package, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

 type Row = { id: string; orderNumber: string; customer: string; device: string; status: string; revenue: number; partsCost: number; labor: number; grossProfit: number; margin: number };
 type Data = { summary: { orders: number; revenue: number; partsCost: number; labor: number; grossProfit: number; averageMargin: number }; orders: Row[]; warning: string | null };

const money = (n: number) => `$${Math.round(Number(n || 0)).toLocaleString("es-CO")}`;
const statusLabel: Record<string, string> = { received: "Recibido", diagnosis: "Diagnóstico", awaiting_approval: "Esperando aprobación", repairing: "En reparación", ready: "Listo", delivered: "Entregado", cancelled: "Cancelado" };

export default function ServiceOrderProfitability() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/service-orders/profitability", { cache: "no-store" })
      .then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error || "No se pudo cargar"); return body as Data; })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar"))
      .finally(() => setLoading(false));
  }, []);

  return <main className="space-y-6 p-2 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Rentabilidad de servicios</h1><p className="text-sm text-muted-foreground">Utilidad bruta estimada de las reparaciones usando el costo de los repuestos.</p></div>
      <Link href="/admin/service-orders"><Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" />Servicio técnico</Button></Link>
    </div>

    {loading && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Calculando rentabilidad...</CardContent></Card>}
    {error && <Card><CardContent className="p-6 text-sm text-red-600 dark:text-red-400">{error}</CardContent></Card>}
    {data && <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Metric icon={Wrench} label="Órdenes" value={String(data.summary.orders)} />
        <Metric icon={CircleDollarSign} label="Facturación" value={money(data.summary.revenue)} />
        <Metric icon={Package} label="Costo repuestos" value={money(data.summary.partsCost)} />
        <Metric icon={TrendingUp} label="Utilidad bruta" value={money(data.summary.grossProfit)} positive={data.summary.grossProfit >= 0} />
        <Metric icon={TrendingUp} label="Margen promedio" value={`${data.summary.averageMargin.toFixed(1)}%`} positive={data.summary.averageMargin >= 0} />
      </div>
      {data.warning && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">{data.warning}</div>}
      <Card><CardHeader><CardTitle>Rentabilidad por orden</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-3">Orden</th><th className="p-3">Equipo</th><th className="p-3">Estado</th><th className="p-3 text-right">Venta</th><th className="p-3 text-right">Costo rep.</th><th className="p-3 text-right">Utilidad</th><th className="p-3 text-right">Margen</th></tr></thead><tbody>{data.orders.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="p-3"><Link className="font-medium hover:underline" href={`/admin/service-orders/${row.id}`}>{row.orderNumber}</Link><div className="text-xs text-muted-foreground">{row.customer}</div></td><td className="p-3">{row.device}</td><td className="p-3"><Badge>{statusLabel[row.status] || row.status}</Badge></td><td className="p-3 text-right">{money(row.revenue)}</td><td className="p-3 text-right">{money(row.partsCost)}</td><td className={`p-3 text-right font-semibold ${row.grossProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{money(row.grossProfit)}</td><td className={`p-3 text-right font-semibold ${row.margin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{row.margin.toFixed(1)}%</td></tr>)}</tbody></table>{data.orders.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">Todavía no hay órdenes de servicio.</div>}</CardContent></Card>
    </>}
  </main>;
}

function Metric({ icon: Icon, label, value, positive }: { icon: typeof CircleDollarSign; label: string; value: string; positive?: boolean }) {
  return <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-muted-foreground"><Icon className="h-4 w-4" /><span className="text-xs">{label}</span></div><p className={`mt-2 text-xl font-semibold ${positive === true ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{value}</p></CardContent></Card>;
}
