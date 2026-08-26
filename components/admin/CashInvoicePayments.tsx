"use client";

import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);

type Invoice = { id: string; invoiceNumber: string; total: number; amountPaid: number; amountDue: number; status: string };

export default function CashInvoicePayments() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const response = await fetch("/api/invoices", { credentials: "include", cache: "no-store" });
    if (!response.ok) return;
    const rows = await response.json();
    setInvoices(rows.filter((invoice: Invoice) => invoice.status !== "cancelled" && Number(invoice.amountDue || 0) > 0));
  }
  useEffect(() => { load(); }, []);

  const selected = invoices.find((invoice) => invoice.id === invoiceId);

  async function submit() {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/cash/payments", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ invoiceId, amount: Number(amount), paymentMethod: method }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo registrar el pago");
      setAmount(""); setInvoiceId(""); setMessage(`Pago registrado. Saldo pendiente: ${money(Number(result.amountDue))}`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error al registrar el pago"); }
    finally { setSaving(false); }
  }

  return <section className="rounded-2xl border bg-card/80 p-5 shadow-sm">
    <div className="mb-4 flex items-center gap-2"><CreditCard className="h-5 w-5 text-amber-600" /><div><h2 className="font-semibold">Cobrar factura</h2><p className="text-xs text-muted-foreground">Registra pagos completos o parciales y actualiza el saldo automáticamente.</p></div></div>
    <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_auto] md:items-end">
      <label className="space-y-1 text-sm"><span>Factura pendiente</span><select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="">Seleccionar factura</option>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {money(Number(invoice.amountDue))}</option>)}</select></label>
      <label className="space-y-1 text-sm"><span>Valor</span><Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Valor" /></label>
      <label className="space-y-1 text-sm"><span>Método</span><select value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="transfer">Transferencia</option><option value="other">Otro</option></select></label>
      <Button disabled={saving || !invoiceId || !amount} onClick={submit}>{saving ? "Guardando..." : "Registrar pago"}</Button>
    </div>
    {selected && <p className="mt-3 text-xs text-muted-foreground">Total {money(Number(selected.total))} · Pagado {money(Number(selected.amountPaid))} · Pendiente <b>{money(Number(selected.amountDue))}</b></p>}
    {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
  </section>;
}
