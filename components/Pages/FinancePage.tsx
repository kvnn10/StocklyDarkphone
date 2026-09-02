"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, BarChart3, Banknote, CalendarDays, CheckCircle2, CircleDollarSign, RefreshCw, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value || 0);
const methodLabel: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", other: "Otro", credit: "Crédito" };

type Finance = {
  period: { from: string; to: string };
  revenue: { sales: number; repairs: number; total: number };
  collected: { sales: number; repairs: number; total: number };
  receivables: { sales: number; repairs: number; total: number };
  grossProfit: { sales: number; repairs: number; total: number; margin: number };
  cash: { income: number; expense: number; balance: number; paymentMovementDifference: number };
  paymentsByMethod: Record<string, number>;
  cashIncomeByMethod: Record<string, number>;
  counts: { sales: number; repairs: number; salePayments: number; repairPayments: number; cashMovements: number };
  reconciliation: { status: "balanced" | "attention"; difference: number };
  recentCashMovements: Array<{ id: string; type: string; amount: number; paymentMethod: string; description: string | null; createdAt: string }>;
};

export default function FinancePage() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const [from, setFrom] = useState(first.toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [data, setData] = useState<Finance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/reports/finance?from=${encodeURIComponent(`${from}T00:00:00`)}&to=${encodeURIComponent(`${to}T23:59:59.999`)}`, { credentials: "include", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo cargar el reporte");
      setData(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Error al cargar el reporte"); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const cards = useMemo(() => data ? [
    { label: "Ingresos generados", value: data.revenue.total, icon: TrendingUp, note: `${data.counts.sales} ventas · ${data.counts.repairs} reparaciones` },
    { label: "Dinero cobrado", value: data.collected.total, icon: CircleDollarSign, note: `${data.counts.salePayments + data.counts.repairPayments} pagos registrados` },
    { label: "Por cobrar", value: data.receivables.total, icon: Wallet, note: "Cartera pendiente" },
    { label: "Utilidad bruta", value: data.grossProfit.total, icon: BarChart3, note: `Margen ${data.grossProfit.margin.toFixed(1)}%` },
    { label: "Saldo de caja", value: data.cash.balance, icon: Banknote, note: `Ingresos ${money(data.cash.income)} · Gastos ${money(data.cash.expense)}` },
  ] : [], []);

  return <main className="space-y-6 p-4 sm:p-6">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><CircleDollarSign className="h-4 w-4" /> Finanzas</div><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Control financiero</h1><p className="mt-1 text-sm text-muted-foreground">Ventas, cobros, cartera, utilidad y caja en un solo lugar.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <Link href="/admin/finance/operations" className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground">Operaciones CxC/CxP</Link>
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border bg-card/80 p-3 shadow-sm"><label className="text-xs text-muted-foreground">Desde<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 block h-9 rounded-lg border bg-background px-2 text-sm" /></label><label className="text-xs text-muted-foreground">Hasta<input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 block h-9 rounded-lg border bg-background px-2 text-sm" /></label><Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualizar</Button></div>
      </div>
    </header>

    {error && <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{error}</div>}
    {loading && !data ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-2xl border bg-muted/40" />)}</div> : data && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{cards.map(({ label, value, icon: Icon, note }) => <div key={label} className="rounded-2xl border bg-card/80 p-5 shadow-sm"><div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" />{label}</div><p className="text-xl font-bold sm:text-2xl">{money(value)}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>)}</div>

      <section className={`rounded-2xl border p-4 shadow-sm ${data.reconciliation.status === "balanced" ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/10"}`}><div className="flex items-start gap-3">{data.reconciliation.status === "balanced" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />}<div><p className="font-semibold">{data.reconciliation.status === "balanced" ? "Conciliación equilibrada" : "Revisión de conciliación requerida"}</p><p className="text-sm text-muted-foreground">Diferencia entre ingresos de caja y pagos registrados: <strong>{money(data.reconciliation.difference)}</strong>.</p></div></div></section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-card/80 p-5 shadow-sm"><h2 className="mb-4 font-semibold">Composición del negocio</h2><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Ventas</p><p className="mt-1 text-xl font-bold">{money(data.revenue.sales)}</p><p className="text-xs text-muted-foreground">Cobrado: {money(data.collected.sales)}</p></div><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Servicio técnico</p><p className="mt-1 text-xl font-bold">{money(data.revenue.repairs)}</p><p className="text-xs text-muted-foreground">Cobrado: {money(data.collected.repairs)}</p></div><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Utilidad ventas</p><p className="mt-1 text-xl font-bold">{money(data.grossProfit.sales)}</p></div><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Utilidad reparaciones</p><p className="mt-1 text-xl font-bold">{money(data.grossProfit.repairs)}</p></div></div></section>
        <section className="rounded-2xl border bg-card/80 p-5 shadow-sm"><h2 className="mb-4 font-semibold">Cobros por medio de pago</h2><div className="space-y-3">{Object.entries(data.paymentsByMethod).length ? Object.entries(data.paymentsByMethod).sort((a,b) => b[1]-a[1]).map(([method, value]) => <div key={method}><div className="mb-1 flex justify-between text-sm"><span>{methodLabel[method] || method}</span><strong>{money(value)}</strong></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, data.collected.total ? (value / data.collected.total) * 100 : 0)}%` }} /></div></div>) : <p className="py-8 text-center text-sm text-muted-foreground">No hay cobros en el período.</p>}</div></section>
      </div>

      <section className="rounded-2xl border bg-card/80 p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Movimientos recientes de caja</h2><p className="text-xs text-muted-foreground">{data.counts.cashMovements} movimientos activos en el período.</p></div><Link href="/admin/cash" className="text-sm font-medium text-primary hover:underline">Abrir Caja</Link></div><div className="space-y-2">{data.recentCashMovements.length ? data.recentCashMovements.map(m => <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="flex min-w-0 items-center gap-3">{m.type === "income" ? <ArrowUpCircle className="h-5 w-5 shrink-0 text-emerald-600" /> : <ArrowDownCircle className="h-5 w-5 shrink-0 text-red-600" />}<div className="min-w-0"><p className="truncate font-medium">{m.description || "Movimiento"}</p><p className="text-xs text-muted-foreground">{methodLabel[m.paymentMethod] || m.paymentMethod} · {new Date(m.createdAt).toLocaleString("es-CO")}</p></div></div><strong className={m.type === "income" ? "text-emerald-600" : "text-red-600"}>{m.type === "income" ? "+" : "-"}{money(m.amount)}</strong></div>) : <p className="py-8 text-center text-sm text-muted-foreground">No hay movimientos recientes.</p>}</div></section>

      <p className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> Período: {new Date(data.period.from).toLocaleDateString("es-CO")} — {new Date(data.period.to).toLocaleDateString("es-CO")}</p>
    </>}
  </main>;
}