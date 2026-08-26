"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BarChart3, BriefcaseBusiness, CircleDollarSign, TrendingUp } from "lucide-react";

type Summary = {
  revenue: number; salesRevenue: number; serviceRevenue: number; directCosts: number; expenses: number;
  grossProfit: number; netProfit: number; grossMargin: number; netMargin: number; orders: number; serviceOrders: number;
};

const money = (v: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v);

export default function AdminProfitabilityCard() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/profitability?months=1", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setData(json?.summary ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10"><TrendingUp className="h-5 w-5" /></div>
          <div><h2 className="font-semibold">Rentabilidad del negocio</h2><p className="text-xs text-muted-foreground">Últimos 30 días · ventas + reparaciones − costos − egresos</p></div>
        </div>
        <Link href="/admin/service-orders/profitability" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Ver detalle <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>

      {loading ? <div className="mt-5 grid gap-3 sm:grid-cols-4"><div className="h-16 animate-pulse rounded-xl bg-muted"/><div className="h-16 animate-pulse rounded-xl bg-muted"/><div className="h-16 animate-pulse rounded-xl bg-muted"/><div className="h-16 animate-pulse rounded-xl bg-muted"/></div> : data ? <>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border bg-background p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><CircleDollarSign className="h-4 w-4"/> Ingresos</div><div className="mt-1 text-lg font-bold">{money(data.revenue)}</div></div>
          <div className="rounded-xl border bg-background p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><BriefcaseBusiness className="h-4 w-4"/> Costos + egresos</div><div className="mt-1 text-lg font-bold">{money(data.directCosts + data.expenses)}</div></div>
          <div className="rounded-xl border bg-background p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="h-4 w-4"/> Utilidad neta</div><div className={`mt-1 text-lg font-bold ${data.netProfit >= 0 ? "text-emerald-500" : "text-red-500"}`}>{money(data.netProfit)}</div></div>
          <div className="rounded-xl border bg-background p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><BarChart3 className="h-4 w-4"/> Margen neto</div><div className={`mt-1 text-lg font-bold ${data.netMargin >= 0 ? "text-emerald-500" : "text-red-500"}`}>{data.netMargin.toFixed(1)}%</div></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>Ventas: <b className="text-foreground">{money(data.salesRevenue)}</b></span><span>Reparaciones: <b className="text-foreground">{money(data.serviceRevenue)}</b></span><span>Órdenes: <b className="text-foreground">{data.orders}</b></span><span>Reparaciones: <b className="text-foreground">{data.serviceOrders}</b></span><span>Margen bruto: <b className="text-foreground">{data.grossMargin.toFixed(1)}%</b></span></div>
      </> : <div className="mt-5 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No se pudo cargar la rentabilidad en este momento.</div>}
    </section>
  );
}
