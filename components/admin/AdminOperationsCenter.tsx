"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface OperationsData {
  generatedAt: string;
  counts: { outOfStock: number; stockCritical: number; overdueReceivables: number; overdueRepairs: number; pendingPurchases: number; reservationIssues: number };
  stock: { outOfStock: Item[]; critical: Item[] };
  receivables: { overdueInvoices: Receivable[]; serviceBalances: Receivable[] };
  repairs: Repair[];
  purchases: Purchase[];
  reservationIssues: { id: string; name: string; quantity: number; reserved: number }[];
}
interface Item { id: string; name: string; sku?: string | null; quantity: number }
interface Receivable { id: string; number: string; amountDue: number; daysOverdue?: number; daysOpen?: number }
interface Repair { id: string; number: string; device: string; status: string; daysOpen: number }
interface Purchase { id: string; number: string; status: string; total: number }

const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
const shortStatus: Record<string, string> = { received: "Recibido", diagnosis: "Diagnóstico", awaiting_approval: "Espera aprobación", repairing: "En reparación", ready: "Listo", draft: "Borrador", partial: "Parcial" };

export default function AdminOperationsCenter() {
  const [data, setData] = useState<OperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/dashboard/operations", { cache: "no-store" });
      if (!response.ok) throw new Error("request failed");
      setData(await response.json());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const totalAlerts = useMemo(() => {
    if (!data) return 0;
    return Object.values(data.counts).reduce((sum, value) => sum + value, 0);
  }, [data]);

  const hasAttention = totalAlerts > 0;

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm" aria-live="polite">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-muted-foreground">Centro de operaciones</p>
            {!loading && (
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${hasAttention ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"}`}>
                {hasAttention ? `${totalAlerts} pendientes` : "Todo al día"}
              </span>
            )}
          </div>
          <h2 className="mt-1 text-xl font-semibold">¿Qué tengo que atender hoy?</h2>
          <p className="mt-1 text-sm text-muted-foreground">Alertas prácticas para inventario, cartera, reparaciones y compras.</p>
        </div>
        <button type="button" onClick={() => load(true)} disabled={refreshing} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
          {refreshing ? "Actualizando…" : "↻ Actualizar"}
        </button>
      </div>

      {loading && <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Skeleton /><Skeleton /><Skeleton /></div>}
      {!loading && error && <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">No se pudo actualizar el centro de operaciones.</p>}

      {!loading && !error && data && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <AlertCard title="Sin existencias" count={data.counts.outOfStock} tone="danger" href="/admin/inventory" />
            <AlertCard title="Stock bajo" count={data.counts.stockCritical} tone="warning" href="/admin/inventory" />
            <AlertCard title="Cartera vencida" count={data.counts.overdueReceivables} tone="warning" href="/admin/receivables" />
            <AlertCard title="Reparaciones atrasadas" count={data.counts.overdueRepairs} tone="warning" href="/admin/service-orders" />
            <AlertCard title="Compras pendientes" count={data.counts.pendingPurchases} tone="neutral" href="/admin/purchase-orders" />
            <AlertCard title="Reservas sin stock" count={data.counts.reservationIssues} tone="danger" href="/admin/inventory" />
          </div>

          {hasAttention && <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <AttentionList title="Inventario" href="/admin/inventory">
              {[...data.stock.outOfStock, ...data.stock.critical].slice(0, 6).map((item) => (
                <Row key={`${item.id}-${item.quantity}`} title={item.name} detail={item.sku || "Sin SKU"} value={`${item.quantity} und.`} />
              ))}
            </AttentionList>
            <AttentionList title="Reparaciones que llevan tiempo" href="/admin/service-orders">
              {data.repairs.slice(0, 6).map((item) => (
                <Row key={item.id} title={`${item.number} · ${item.device}`} detail={shortStatus[item.status] || item.status} value={`${item.daysOpen} días`} />
              ))}
            </AttentionList>
            <AttentionList title="Cartera vencida" href="/admin/receivables">
              {[...data.receivables.overdueInvoices, ...data.receivables.serviceBalances].slice(0, 6).map((item) => (
                <Row key={item.id} title={item.number} detail={item.daysOverdue ? `${item.daysOverdue} días vencida` : `${item.daysOpen ?? 0} días abierta`} value={money(item.amountDue)} />
              ))}
            </AttentionList>
            <AttentionList title="Órdenes de compra pendientes" href="/admin/purchase-orders">
              {data.purchases.slice(0, 6).map((item) => (
                <Row key={item.id} title={item.number} detail={shortStatus[item.status] || item.status} value={money(item.total)} />
              ))}
            </AttentionList>
          </div>}
        </>
      )}

      {!loading && !error && data && <p className="mt-4 text-right text-xs text-muted-foreground">Actualización automática cada 60 segundos · {new Date(data.generatedAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</p>}
    </section>
  );
}

function AlertCard({ title, count, tone, href }: { title: string; count: number; tone: "danger" | "warning" | "neutral"; href: string }) {
  const toneClass = tone === "danger" ? "border-red-500/20 bg-red-500/5" : tone === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-border bg-muted/20";
  return <a href={href} className={`block rounded-xl border p-4 transition hover:bg-muted/40 ${toneClass}`}><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{title}</span><span className="text-2xl font-bold tabular-nums">{count}</span></div><span className="mt-2 block text-xs text-muted-foreground">Ver pendientes →</span></a>;
}

function AttentionList({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return <div className="rounded-xl border p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><a href={href} className="text-xs font-medium text-muted-foreground hover:text-foreground">Ver todo →</a></div>{children}</div>;
}

function Row({ title, detail, value }: { title: string; detail: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 border-t py-2.5 first:border-t-0"><div className="min-w-0"><p className="truncate text-sm font-medium">{title}</p><p className="truncate text-xs text-muted-foreground">{detail}</p></div><span className="shrink-0 text-sm font-semibold tabular-nums">{value}</span></div>;
}

function Skeleton() { return <div className="h-24 animate-pulse rounded-xl border bg-muted/20" />; }
