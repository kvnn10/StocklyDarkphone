"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, WalletCards, AlertTriangle, CheckCircle2 } from "lucide-react";

 type Payable = {
  _id: string;
  supplierName: string;
  reference?: string | null;
  purchaseOrderId?: string | null;
  originalAmount: number;
  amountPaid: number;
  amountDue: number;
  status: "open" | "partial" | "paid";
  dueDate: string;
  createdAt: string;
 };

const money = (v: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v || 0);
const statusLabel: Record<string, string> = { open: "Pendiente", partial: "Parcial", paid: "Pagada" };
const methodLabel: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", other: "Otro" };

export default function PayablesWorkspace() {
  const [rows, setRows] = useState<Payable[]>([]);
  const [includePaid, setIncludePaid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/payables?includePaid=${includePaid}`, { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar las cuentas por pagar");
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar las cuentas por pagar");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [includePaid]);

  const summary = useMemo(() => rows.reduce((acc, row) => {
    acc.total += Number(row.originalAmount) || 0;
    acc.paid += Number(row.amountPaid) || 0;
    acc.due += Number(row.amountDue) || 0;
    return acc;
  }, { total: 0, paid: 0, due: 0 }), [rows]);

  async function pay(row: Payable) {
    if (row.amountDue <= 0) return;
    const raw = window.prompt(`Pago a ${row.supplierName}\nSaldo pendiente: ${money(row.amountDue)}\n\nMonto a pagar:`, String(row.amountDue));
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0 || amount > row.amountDue + 0.0001) {
      setMessage(`El pago debe ser mayor que cero y no superar ${money(row.amountDue)}.`);
      return;
    }
    const method = window.prompt("Medio de pago: cash, card, transfer u other", "transfer")?.trim().toLowerCase();
    if (!method || !Object.prototype.hasOwnProperty.call(methodLabel, method)) {
      setMessage("Medio de pago inválido.");
      return;
    }
    if (!confirm(`¿Registrar ${money(amount)} como pago a ${row.supplierName}? Se reflejará como egreso de caja y quedará en el historial del proveedor.`)) return;

    setPaying(row._id); setMessage("");
    try {
      const res = await fetch("/api/finance/payables", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ id: row._id, amount, paymentMethod: method }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo registrar el pago");
      setMessage(`Pago registrado. Saldo restante: ${money(Number(data.amountDue) || 0)}.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo registrar el pago"); }
    finally { setPaying(null); }
  }

  const overdue = (row: Payable) => row.status !== "paid" && new Date(row.dueDate).getTime() < Date.now();

  return <main className="space-y-6 p-4 sm:p-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground"><WalletCards className="h-4 w-4" /> Cuentas por pagar</div><h1 className="text-2xl font-bold">Proveedores y obligaciones</h1><p className="mt-1 text-sm text-muted-foreground">Las recepciones de compra generan la deuda; los pagos descuentan saldo y registran el egreso en caja.</p></div>
      <div className="flex gap-2"><label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><input type="checkbox" checked={includePaid} onChange={e => setIncludePaid(e.target.checked)} /> Mostrar pagadas</label><button onClick={() => load()} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualizar</button></div>
    </header>

    {message && <div className="rounded-xl border bg-card px-4 py-3 text-sm">{message}</div>}

    <div className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">Obligaciones</p><p className="mt-1 text-xl font-bold">{money(summary.total)}</p></div><div className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">Pagado</p><p className="mt-1 text-xl font-bold">{money(summary.paid)}</p></div><div className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">Saldo pendiente</p><p className="mt-1 text-xl font-bold">{money(summary.due)}</p></div></div>

    <section className="overflow-hidden rounded-2xl border bg-card"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="border-b bg-muted/30"><tr className="text-left"><th className="px-4 py-3">Proveedor</th><th className="px-4 py-3">Referencia</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Pagado</th><th className="px-4 py-3">Saldo</th><th className="px-4 py-3">Vencimiento</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3"></th></tr></thead><tbody>{loading ? <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">Cargando…</td></tr> : rows.length === 0 ? <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No hay cuentas por pagar para mostrar.</td></tr> : rows.map(row => <tr key={row._id} className="border-b last:border-0"><td className="px-4 py-3 font-medium">{row.supplierName}</td><td className="px-4 py-3 text-muted-foreground">{row.reference || "—"}</td><td className="px-4 py-3">{money(Number(row.originalAmount))}</td><td className="px-4 py-3">{money(Number(row.amountPaid))}</td><td className="px-4 py-3 font-semibold">{money(Number(row.amountDue))}</td><td className="px-4 py-3"><span className="inline-flex items-center gap-1">{overdue(row) ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{new Date(row.dueDate).toLocaleDateString("es-CO")}</span></td><td className="px-4 py-3">{statusLabel[row.status] || row.status}</td><td className="px-4 py-3 text-right">{row.status !== "paid" && <button onClick={() => pay(row)} disabled={paying === row._id} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{paying === row._id ? "Registrando…" : "Pagar"}</button>}</td></tr>)}</tbody></table></div></section>
  </main>;
}
