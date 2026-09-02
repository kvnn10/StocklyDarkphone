"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const PAYMENT_METHODS = [
  ["cash", "Efectivo"],
  ["card", "Tarjeta"],
  ["transfer", "Transferencia"],
  ["nequi", "Nequi"],
  ["daviplata", "Daviplata"],
  ["other", "Otro"],
] as const;

type SalePayment = {
  id: string;
  amount: number | string;
  paymentMethod: string;
  createdAt: string;
  status: string;
};

type PaymentData = {
  total: number;
  paid: number;
  due: number;
  paymentStatus: string;
  payments: SalePayment[];
};

export default function SalePaymentPanel({ orderId }: { orderId: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<PaymentData | null>(null);
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadPayments() {
    setLoading(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/payments`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "No se pudieron cargar los pagos");
      setData(json);
      if (Number(json.due) > 0) setAmount(Number(json.due).toFixed(2));
    } catch (error) {
      toast({
        title: "No se pudo cargar pagos",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (orderId) void loadPayments();
  }, [orderId]);

  async function handlePayment() {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      toast({ title: "Monto inválido", description: "Ingresa un monto mayor que cero.", variant: "destructive" });
      return;
    }
    if (data && numericAmount > data.due + 0.009) {
      toast({ title: "Monto superior al saldo", description: `El saldo pendiente es $${data.due.toFixed(2)}.`, variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: numericAmount, paymentMethod }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "No se pudo registrar el pago");
      setData((current) => current ? { ...current, paid: json.paid, due: json.due, paymentStatus: json.paymentStatus, payments: [json.payment, ...current.payments] } : current);
      setAmount(Number(json.due) > 0 ? Number(json.due).toFixed(2) : "");
      toast({ title: "Pago registrado", description: Number(json.due) > 0 ? `Saldo pendiente: $${Number(json.due).toFixed(2)}` : "La venta quedó totalmente pagada." });
    } catch (error) {
      toast({ title: "No se pudo registrar el pago", description: error instanceof Error ? error.message : "Error inesperado", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const due = data?.due ?? 0;
  const paid = data?.paid ?? 0;
  const total = data?.total ?? 0;
  const progress = total > 0 ? Math.min(100, (paid / total) * 100) : 0;

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-6 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-[24px] border border-gray-200/60 bg-white/70 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
        <div className="border-b border-gray-200/60 px-4 py-4 dark:border-white/10 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-emerald-500/10 p-2.5 dark:bg-emerald-500/20">
                <Wallet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Pagos de la venta</h2>
                <p className="text-xs text-muted-foreground">Registra abonos o cobra el saldo pendiente sin salir del detalle.</p>
              </div>
            </div>
            {data && <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">{data.paymentStatus === "paid" ? "Pagada" : data.paymentStatus === "partial" ? "Abono parcial" : "Pendiente"}</span>}
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-6">
          <div className="rounded-2xl border border-gray-200/60 p-4 dark:border-white/10">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="mt-1 text-xl font-semibold">${total.toFixed(2)}</p>
          </div>
          <div className="rounded-2xl border border-gray-200/60 p-4 dark:border-white/10">
            <p className="text-xs text-muted-foreground">Pagado</p>
            <p className="mt-1 text-xl font-semibold text-emerald-600 dark:text-emerald-400">${paid.toFixed(2)}</p>
          </div>
          <div className="rounded-2xl border border-gray-200/60 p-4 dark:border-white/10">
            <p className="text-xs text-muted-foreground">Saldo pendiente</p>
            <p className="mt-1 text-xl font-semibold text-amber-600 dark:text-amber-400">${due.toFixed(2)}</p>
          </div>
        </div>

        <div className="px-4 pb-2 sm:px-6">
          <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {due > 0 && (
          <div className="grid gap-3 border-t border-gray-200/60 p-4 dark:border-white/10 sm:grid-cols-[1fr_180px_auto] sm:p-6">
            <div>
              <label className="mb-1.5 block text-xs font-medium">Monto a cobrar</label>
              <Input type="number" min="0.01" max={due} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" disabled={saving || loading} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium">Método</label>
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={saving || loading} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {PAYMENT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <Button onClick={handlePayment} disabled={saving || loading} className="w-full gap-2 sm:w-auto">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                {saving ? "Registrando..." : "Registrar pago"}
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 border-t border-gray-200/60 p-4 text-sm text-muted-foreground dark:border-white/10 sm:p-6"><Loader2 className="h-4 w-4 animate-spin" />Cargando historial de pagos...</div>
        ) : data?.payments.length ? (
          <div className="border-t border-gray-200/60 dark:border-white/10">
            <div className="flex items-center gap-2 px-4 py-3 text-sm font-medium sm:px-6"><Receipt className="h-4 w-4" />Historial</div>
            <div className="divide-y divide-gray-200/60 dark:divide-white/10">
              {data.payments.map((payment) => (
                <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm sm:px-6">
                  <div>
                    <p className="font-medium">${Number(payment.amount).toFixed(2)} · {PAYMENT_METHODS.find(([value]) => value === payment.paymentMethod)?.[1] ?? payment.paymentMethod}</p>
                    <p className="text-xs text-muted-foreground">{new Date(payment.createdAt).toLocaleString("es-CO")}</p>
                  </div>
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">Registrado</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="border-t border-gray-200/60 p-4 text-sm text-muted-foreground dark:border-white/10 sm:p-6">Aún no hay pagos registrados.</div>
        )}
      </div>
    </section>
  );
}
