"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, CalendarDays, CircleDollarSign, ShoppingCart, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageContentWrapper, PageSectionHeader } from "@/components/shared";
import type { DashboardStats } from "@/types";

const money = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);

export function summarizeSales(stats: DashboardStats) {
  const trends = stats.trends ?? [];
  const revenue = trends.reduce((sum, point) => sum + Number(point.revenue ?? 0), 0);
  const orders = trends.reduce((sum, point) => sum + Number(point.orders ?? 0), 0);
  return { revenue, orders, months: trends.length };
}

type Props = { stats: DashboardStats };

export default function ReportsDashboard({ stats }: Props) {
  const trends = (stats.trends ?? []).map((point) => ({
    label: point.label,
    ventas: Number(point.revenue ?? 0),
    pedidos: Number(point.orders ?? 0),
  }));
  const summary = summarizeSales(stats);
  const current = trends[trends.length - 1];
  const previous = trends[trends.length - 2];
  const revenueDelta = previous?.ventas
    ? ((current.ventas - previous.ventas) / previous.ventas) * 100
    : null;

  return (
    <PageContentWrapper>
      <div className="space-y-6">
        <PageSectionHeader
          as="h1"
          icon={BarChart3}
          tone="violet"
          title="Reportes PRO"
          description="Indicadores comerciales para tomar decisiones sobre ventas, pedidos y evolución mensual."
          trailing={
            <Link
              href="/admin/dashboard-overall-insights"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              Dashboard completo <ArrowRight className="h-4 w-4" />
            </Link>
          }
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><CircleDollarSign className="h-4 w-4" /> Ventas últimos 12 meses</div>
            <p className="mt-2 text-2xl font-bold">{money(summary.revenue)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Suma de la tendencia mensual disponible</p>
          </section>
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><ShoppingCart className="h-4 w-4" /> Pedidos últimos 12 meses</div>
            <p className="mt-2 text-2xl font-bold">{summary.orders.toLocaleString("es-CO")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{summary.months} períodos mensuales</p>
          </section>
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><TrendingUp className="h-4 w-4" /> Variación mensual</div>
            <p className={`mt-2 text-2xl font-bold ${revenueDelta == null || revenueDelta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {revenueDelta == null ? "—" : `${revenueDelta >= 0 ? "+" : ""}${revenueDelta.toFixed(1)}%`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Comparación del último mes contra el anterior</p>
          </section>
        </div>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Ventas por mes</h2>
              <p className="text-sm text-muted-foreground">Evolución de ingresos y cantidad de pedidos</p>
            </div>
            <CalendarDays className="h-5 w-5 text-violet-500" />
          </div>
          <div className="h-[320px] w-full">
            {trends.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trends} margin={{ top: 10, right: 12, left: 4, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000000)}M`} />
                  <Tooltip formatter={(value, name) => [name === "ventas" ? money(Number(value)) : Number(value), name === "ventas" ? "Ventas" : "Pedidos"]} />
                  <Bar dataKey="ventas" name="Ventas" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">No hay datos de ventas para mostrar.</div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2"><CalendarDays className="h-4 w-4 text-violet-500" /><h2 className="font-semibold">Detalle mensual</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="px-3 py-2 font-medium">Período</th><th className="px-3 py-2 text-right font-medium">Ventas</th><th className="px-3 py-2 text-right font-medium">Pedidos</th><th className="px-3 py-2 text-right font-medium">Promedio/pedido</th></tr></thead>
              <tbody>{trends.map((row) => <tr key={row.label} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{row.label}</td><td className="px-3 py-2 text-right">{money(row.ventas)}</td><td className="px-3 py-2 text-right">{row.pedidos.toLocaleString("es-CO")}</td><td className="px-3 py-2 text-right">{money(row.pedidos > 0 ? row.ventas / row.pedidos : 0)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>
    </PageContentWrapper>
  );
}
