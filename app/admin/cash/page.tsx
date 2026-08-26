"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Banknote, Plus, Wallet, Ban, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageSectionHeader } from "@/components/shared/PageSectionHeader";

const money = (value: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);

type Movement = { _id: string; type: "income" | "expense"; amount: number; paymentMethod: string; description: string; createdAt: string; status?: "active" | "voided"; voidReason?: string };
const methodLabel: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", other: "Otro" };

export default function CashPage() {
  const [data, setData] = useState<{ movements: Movement[]; summary: { income: number; expense: number; balance: number } }>({ movements: [], summary: { income: 0, expense: 0, balance: 0 } });
  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [voidingId, setVoidingId] = useState<string | null>(null);

  async function load() { const response = await fetch("/api/cash", { credentials: "include" }); if (response.ok) setData(await response.json()); }
  useEffect(() => { load(); }, []);

  async function saveMovement() {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/cash", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ type, amount: Number(amount), paymentMethod, description }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "No se pudo guardar");
      setAmount(""); setDescription(""); setMessage("Movimiento registrado correctamente."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error al registrar movimiento"); } finally { setSaving(false); }
  }

  async function voidMovement(movement: Movement) {
    if (movement.status === "voided") return;
    if (!window.confirm(`¿Anular este movimiento de ${money(Number(movement.amount))}?\n\nNo afectará el saldo de Caja.`)) return;
    const reason = window.prompt("Motivo de la anulación:", "Movimiento registrado por error")?.trim(); if (reason === null) return;
    setVoidingId(movement._id); setMessage("");
    try {
      const response = await fetch("/api/cash", { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ id: movement._id, reason: reason || "Movimiento anulado manualmente" }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "No se pudo anular");
      setMessage("Movimiento anulado correctamente."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error al anular movimiento"); } finally { setVoidingId(null); }
  }

  const active = useMemo(() => data.movements.filter((m) => m.status !== "voided"), [data.movements]);
  const byMethod = useMemo(() => {
    const result: Record<string, number> = { cash: 0, card: 0, transfer: 0, other: 0 };
    active.forEach((m) => { result[m.paymentMethod] = (result[m.paymentMethod] || 0) + (m.type === "income" ? Number(m.amount) : -Number(m.amount)); });
    return result;
  }, [active]);

  const cards = [
    { label: "Saldo total", value: data.summary.balance, icon: Wallet },
    { label: "Ingresos", value: data.summary.income, icon: ArrowUpCircle },
    { label: "Egresos", value: data.summary.expense, icon: ArrowDownCircle },
  ];

  return <main className="space-y-6 p-4 sm:p-6">
    <PageSectionHeader title="Caja" description="Control de ingresos, egresos y movimientos de dinero." tone="amber" icon={Banknote} />
    <div className="grid gap-4 md:grid-cols-3">{cards.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-2xl border bg-card/80 p-5 shadow-sm"><div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" />{label}</div><p className="text-2xl font-bold">{money(value)}</p></div>)}</div>

    <section className="rounded-2xl border bg-card/80 p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2"><Calculator className="h-5 w-5 text-amber-600" /><h2 className="font-semibold">Saldo por medio de pago</h2></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(byMethod).map(([method, value]) => <div key={method} className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">{methodLabel[method] || method}</p><p className="mt-1 text-xl font-bold">{money(value)}</p></div>)}</div>
      <p className="mt-3 text-xs text-muted-foreground">Se calcula con los movimientos activos registrados en Caja.</p>
    </section>

    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <section className="rounded-2xl border bg-card/80 p-5 shadow-sm"><h2 className="mb-4 font-semibold">Nuevo movimiento</h2><div className="space-y-3">
        <select value={type} onChange={(e) => setType(e.target.value as "income" | "expense")} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="expense">Egreso</option><option value="income">Ingreso</option></select>
        <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Valor" />
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="transfer">Transferencia</option><option value="other">Otro</option></select>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción" />
        <Button disabled={saving || !amount} onClick={saveMovement} className="w-full bg-amber-600 hover:bg-amber-700"><Plus className="mr-2 h-4 w-4" />{saving ? "Guardando..." : "Registrar movimiento"}</Button>{message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div></section>

      <section className="rounded-2xl border bg-card/80 p-5 shadow-sm"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-semibold">Movimientos recientes</h2><span className="text-xs text-muted-foreground">{active.length} activos</span></div><div className="space-y-2">
        {data.movements.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Aún no hay movimientos.</p> : data.movements.map((movement) => { const voided = movement.status === "voided"; return <div key={movement._id} className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${voided ? "opacity-60" : ""}`}>
          <div className="flex min-w-0 items-center gap-3"><div className={`rounded-lg p-2 ${voided ? "bg-muted text-muted-foreground" : movement.type === "income" ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>{voided ? <Ban className="h-4 w-4" /> : movement.type === "income" ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}</div><div className="min-w-0"><p className={`truncate font-medium ${voided ? "line-through" : ""}`}>{movement.description || "Movimiento"}</p><p className="text-xs text-muted-foreground">{methodLabel[movement.paymentMethod] || movement.paymentMethod} · {new Date(movement.createdAt).toLocaleString("es-CO")}{voided ? " · ANULADO" : ""}</p>{voided && movement.voidReason && <p className="truncate text-xs text-muted-foreground">Motivo: {movement.voidReason}</p>}</div></div>
          <div className="flex shrink-0 items-center gap-3"><span className={`font-semibold ${voided ? "text-muted-foreground" : movement.type === "income" ? "text-emerald-600" : "text-red-600"}`}>{voided ? "ANULADO" : `${movement.type === "income" ? "+" : "-"}${money(Number(movement.amount))}`}</span>{!voided && <Button variant="ghost" size="icon" title="Anular movimiento" aria-label="Anular movimiento" disabled={voidingId === movement._id} onClick={() => voidMovement(movement)}><Ban className="h-4 w-4" /></Button>}</div>
        </div>; })}
      </div></section>
    </div>
  </main>;
}
