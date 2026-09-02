"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type Reconciliation = {
  ok?: boolean;
  issueCount?: number;
  checked?: { ledgerEntries?: number; payments?: number; refunds?: number; orders?: number; invoices?: number };
};

export default function AdminPaymentReconciliationCard() {
  const [data, setData] = useState<Reconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(initial = false) {
    if (initial) setLoading(true); else setRefreshing(true);
    try {
      const response = await fetch("/api/payments/reconciliation", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("reconciliation failed");
      setData(await response.json());
    } catch {
      setData(null);
    } finally {
      if (initial) setLoading(false); else setRefreshing(false);
    }
  }

  useEffect(() => { void load(true); }, []);

  const healthy = data?.ok === true;
  const issueCount = data?.issueCount ?? 0;
  const checked = data?.checked;

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm" aria-live="polite">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold">Reconciliación de pagos</h2>
            <p className="text-xs text-muted-foreground">Stripe ↔ Caja ↔ Factura ↔ Venta</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || refreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Revisar ahora
        </Button>
      </div>

      {loading ? (
        <div className="mt-5 h-20 animate-pulse rounded-xl bg-muted" />
      ) : !data ? (
        <div className="mt-5 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          No fue posible ejecutar la conciliación. No se modificaron datos.
        </div>
      ) : (
        <>
          <div className="mt-5 flex items-center gap-3">
            {healthy ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
            <div>
              <p className="font-medium">{healthy ? "Todo conciliado" : `${issueCount} diferencia${issueCount === 1 ? "" : "s"} detectada${issueCount === 1 ? "" : "s"}`}</p>
              <p className="text-xs text-muted-foreground">Solo lectura; la revisión no corrige ni modifica movimientos.</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Metric label="Ledger" value={checked?.ledgerEntries ?? 0} />
            <Metric label="Pagos" value={checked?.payments ?? 0} />
            <Metric label="Reembolsos" value={checked?.refunds ?? 0} />
            <Metric label="Ventas" value={checked?.orders ?? 0} />
            <Metric label="Facturas" value={checked?.invoices ?? 0} />
          </div>
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
