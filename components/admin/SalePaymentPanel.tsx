"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, DollarSign, Loader2, RefreshCw, WalletCards } from "lucide-react";

const METHODS = [
  ["cash", "Efectivo"],
  ["card", "Tarjeta"],
  ["transfer", "Transferencia"],
  ["nequi", "Nequi"],
  ["daviplata", "Daviplata"],
  ["other", "Otro"],
] as const;

type Payment = { id: string; amount: number; paymentMethod: string; createdAt: string };
type PaymentState = { orderId: string; orderNumber: string; total: number; paid: number; due: number; paymentStatus: string; payments: Payment[] };

function money(value: number) {
  return `$${value.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function SalePaymentPanel({ orderId }: { orderId: string }) {
  const [data, setData] = useState<PaymentState | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/payments`, { credentials: "include", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudieron cargar los pagos");
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando pagos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [orderId]);

  const suggested = useMemo(() => data?.due ?? 0, [data]);

  const recordPayment = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Ingresa un valor de abono válido.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/payments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: numericAmount, paymentMethod: method }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo registrar el pago");
      setAmount("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el pago");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <div className="rounded-2xl border p-5 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando pagos...</div>;
  if (!data) return <div className="rounded-2xl border p-5 text-sm text-red-600">{error || "No hay información de pagos."}</div>;

  return (
    <section className="rounded-2xl border border-gray-200/60 dark:border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-md p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600"><WalletCards className="h-5 w-5" /></div>
          <div><h3 className="font-semibold">Pagos de la venta</h3><p className="text-xs text-muted-foreground">Abonos y saldo sincronizados con Caja y Cartera</p></div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">Total</p><p className="font-semibold">{money(data.total)}</p></div>
        <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">Pagado</p><p className="font-semibold text-emerald-600">{money(data.paid)}</p></div>
        <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">Saldo</p><p className={`font-semibold ${data.due > 0 ? "text-amber-600" : "text-emerald-600"}`}>{money(data.due)}</p></div>
      </div>

      {data.due > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
          <div><label className="text-xs font-medium">Valor del abono</label><Input className="mt-1" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={suggested.toFixed(2)} /></div>
          <div><label className="text-xs font-medium">Método</label><Select value={method} onValueChange={setMethod}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{METHODS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          <Button onClick={() => void recordPayment()} disabled={saving} className="gap-2"><DollarSign className="h-4 w-4" />{saving ? "Registrando..." : "Registrar pago"}</Button>
        </div>
      )}

      {data.due <= 0 && <div className="rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 p-3 text-sm font-medium">Venta totalmente pagada.</div>}
      {error && <div className="rounded-xl bg-red-500/10 text-red-600 p-3 text-sm">{error}</div>}

      {data.payments.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Historial de pagos</div>
          {data.payments.map((payment) => (
            <div key={payment.id} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
              <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-muted-foreground" /><span>{METHODS.find(([value]) => value === payment.paymentMethod)?.[1] ?? payment.paymentMethod}</span><span className="text-xs text-muted-foreground">{new Date(payment.createdAt).toLocaleString("es-CO")}</span></div>
              <span className="font-semibold">{money(Number(payment.amount))}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
