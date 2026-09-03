"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, BarChart3, Banknote, CalendarDays, CircleDollarSign, RefreshCw, TrendingDown, TrendingUp, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const money = (v: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(v) || 0);
const methods = [["cash", "Efectivo"], ["card", "Tarjeta"], ["transfer", "Transferencia"], ["other", "Otro"]];
const methodLabel: Record<string, string> = Object.fromEntries(methods);

type Account = { _id: string; orderNumber?: string; reference?: string; clientId?: string; clientName?: string; supplierId?: string; supplierName?: string; amountDue: number; dueDate?: string | null };
type Advance = { _id: string; type: "customer" | "supplier"; partyId: string; partyName: string; originalAmount: number; amountApplied: number; amountAvailable: number; status: string; paymentMethod: string; reference?: string | null; createdAt: string };
type Party = { id: string; name: string };
type Report = { revenue: { sales: number; repairs: number; total: number }; collected: { sales: number; repairs: number; total: number }; receivables: { sales: number; repairs: number; total: number }; grossProfit: { sales: number; repairs: number; total: number; margin: number }; cash: { income: number; expense: number; balance: number }; counts: { sales: number; repairs: number }; reconciliation: { status: string; difference: number } };
type Expense = { amount: number; category?: string; description?: string; createdAt: string };
type Order = { id: string; total: number; status?: string; createdAt: string; createdBy?: string; items?: Array<{ productId?: string; productName?: string; quantity: number; price?: number; subtotal?: number }> };
type Service = { id: string; total: number; status?: string; createdAt: string; createdBy?: string; laborAmount?: number; items?: Array<{ productId?: string; productName?: string; quantity: number; unitCost?: number; unitPrice?: number; subtotal?: number }> };
type Product = { id: string; name: string; sku?: string; price: number; purchasePrice: number };

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try { const r = await fetch(url, { credentials: "include", cache: "no-store" }); if (!r.ok) return fallback; const d = await r.json(); return d as T; } catch { return fallback; }
}

export default function FinanceOperationsPage() {
  const [tab, setTab] = useState<"customer" | "supplier">("customer");
  const [section, setSection] = useState<"operations" | "analytics">("operations");
  const [accounts, setAccounts] = useState<Account[]>([]); const [advances, setAdvances] = useState<Advance[]>([]); const [parties, setParties] = useState<Party[]>([]);
  const [report, setReport] = useState<Report | null>(null); const [expenses, setExpenses] = useState<Expense[]>([]); const [orders, setOrders] = useState<Order[]>([]); const [services, setServices] = useState<Service[]>([]); const [products, setProducts] = useState<Product[]>([]);
  const [from, setFrom] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [partyId, setPartyId] = useState(""); const [targetId, setTargetId] = useState(""); const [amount, setAmount] = useState(""); const [method, setMethod] = useState("cash"); const [reference, setReference] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");

  const loadOperations = useCallback(async () => {
    const [a, av, p] = await Promise.all([
      getJson<Account[]>(tab === "customer" ? "/api/finance/receivables" : "/api/finance/payables", []),
      getJson<Advance[]>(`/api/finance/advances?type=${tab}`, []),
      getJson<Party[]>(tab === "customer" ? "/api/clients" : "/api/suppliers", []),
    ]);
    setAccounts(Array.isArray(a) ? a : []); setAdvances(Array.isArray(av) ? av : []); setParties(Array.isArray(p) ? p : []);
  }, [tab]);

  const loadAnalytics = useCallback(async () => {
    const q = `?from=${encodeURIComponent(`${from}T00:00:00`)}&to=${encodeURIComponent(`${to}T23:59:59.999`)}`;
    const [r, e, o, s, p] = await Promise.all([
      getJson<Report | null>(`/api/reports/finance${q}`, null),
      getJson<Expense[]>("/api/finance/expenses", []),
      getJson<Order[]>("/api/orders", []),
      getJson<Service[]>("/api/service-orders", []),
      getJson<Product[]>("/api/products", []),
    ]);
    setReport(r); setExpenses(Array.isArray(e) ? e : []); setOrders(Array.isArray(o) ? o : []); setServices(Array.isArray(s) ? s : []); setProducts(Array.isArray(p) ? p : []);
  }, [from, to]);

  const load = useCallback(async () => { setBusy(true); await Promise.all([loadOperations(), loadAnalytics()]); setBusy(false); }, [loadOperations, loadAnalytics]);
  useEffect(() => { setPartyId(""); setTargetId(""); void loadOperations(); }, [loadOperations]);
  useEffect(() => { void loadAnalytics(); }, [loadAnalytics]);

  const filtered = partyId ? accounts.filter(a => (tab === "customer" ? a.clientId : a.supplierId) === partyId) : accounts;
  const periodExpenses = useMemo(() => expenses.filter(e => { const d = new Date(e.createdAt); return d >= new Date(`${from}T00:00:00`) && d <= new Date(`${to}T23:59:59.999`); }), [expenses, from, to]);
  const operatingExpenses = useMemo(() => periodExpenses.reduce((s, e) => s + Number(e.amount || 0), 0), [periodExpenses]);
  const netProfit = (report?.grossProfit.total || 0) - operatingExpenses;

  const productProfitability = useMemo(() => {
    const costMap = new Map(products.map(p => [p.id, Number(p.purchasePrice || 0)])); const rows = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
    for (const o of orders.filter(x => x.status !== "cancelled")) for (const i of o.items || []) { const key = i.productId || i.productName || "sin-producto"; const row = rows.get(key) || { name: i.productName || "Producto", qty: 0, revenue: 0, cost: 0 }; const qty = Number(i.quantity || 0); row.qty += qty; row.revenue += Number(i.subtotal ?? (i.price || 0) * qty); row.cost += costMap.get(key) ? costMap.get(key)! * qty : 0; rows.set(key, row); }
    return [...rows.values()].map(r => ({ ...r, profit: r.revenue - r.cost, margin: r.revenue ? ((r.revenue - r.cost) / r.revenue) * 100 : 0 })).sort((a, b) => b.profit - a.profit).slice(0, 12);
  }, [orders, products]);

  const serviceProfitability = useMemo(() => services.filter(x => x.status !== "cancelled").map(s => { const cost = (s.items || []).reduce((n, i) => n + Number(i.unitCost || 0) * Number(i.quantity || 0), 0); const revenue = Number(s.total || 0); return { id: s.id, revenue, cost, profit: revenue - cost, margin: revenue ? ((revenue - cost) / revenue) * 100 : 0 }; }).sort((a, b) => b.profit - a.profit).slice(0, 12), [services]);

  const sellerProfitability = useMemo(() => {
    const rows = new Map<string, { seller: string; revenue: number; cost: number; orders: number }>();
    for (const o of orders.filter(x => x.status !== "cancelled")) { const seller = o.createdBy || "usuario actual"; const cost = (o.items || []).reduce((n, i) => n + Number(i.quantity || 0) * (products.find(p => p.id === i.productId)?.purchasePrice || 0), 0); const row = rows.get(seller) || { seller, revenue: 0, cost: 0, orders: 0 }; row.revenue += Number(o.total || 0); row.cost += cost; row.orders++; rows.set(seller, row); }
    return [...rows.values()].map(r => ({ ...r, profit: r.revenue - r.cost, margin: r.revenue ? ((r.revenue - r.cost) / r.revenue) * 100 : 0 })).sort((a, b) => b.profit - a.profit);
  }, [orders, products]);

  const periodProfitability = useMemo(() => {
    const rows = new Map<string, { period: string; revenue: number; cost: number }>();
    for (const o of orders.filter(x => x.status !== "cancelled")) { const d = new Date(o.createdAt); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; const cost = (o.items || []).reduce((n, i) => n + Number(i.quantity || 0) * (products.find(p => p.id === i.productId)?.purchasePrice || 0), 0); const row = rows.get(key) || { period: key, revenue: 0, cost: 0 }; row.revenue += Number(o.total || 0); row.cost += cost; rows.set(key, row); }
    for (const s of services.filter(x => x.status !== "cancelled")) { const d = new Date(s.createdAt); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; const cost = (s.items || []).reduce((n, i) => n + Number(i.unitCost || 0) * Number(i.quantity || 0), 0); const row = rows.get(key) || { period: key, revenue: 0, cost: 0 }; row.revenue += Number(s.total || 0); row.cost += cost; rows.set(key, row); }
    return [...rows.values()].map(r => ({ ...r, profit: r.revenue - r.cost, margin: r.revenue ? ((r.revenue - r.cost) / r.revenue) * 100 : 0 })).sort((a, b) => a.period.localeCompare(b.period));
  }, [orders, services, products]);

  async function postAdvance() { const value = Number(amount); if (!partyId || !Number.isFinite(value) || value <= 0) { setMessage("Selecciona un tercero e indica un valor válido."); return; } setBusy(true); setMessage(""); try { const r = await fetch("/api/finance/advances", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ type: tab, partyId, amount: value, paymentMethod: method, reference, idempotencyKey: `ui-${tab}-${partyId}-${Date.now()}` }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "No se pudo registrar"); setAmount(""); setReference(""); setMessage(`Anticipo de ${money(value)} registrado.`); await loadOperations(); } catch (e) { setMessage(e instanceof Error ? e.message : "Error al registrar"); } finally { setBusy(false); } }
  async function applyAdvance(a: Advance) { if (!targetId) { setMessage("Selecciona una cuenta destino."); return; } const value = Number(window.prompt(`Disponible: ${money(a.amountAvailable)}\nValor a aplicar:`, String(a.amountAvailable))); if (!Number.isFinite(value) || value <= 0) return; setBusy(true); setMessage(""); try { const r = await fetch("/api/finance/advances", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ id: a._id, targetId, amount: value }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "No se pudo aplicar"); setMessage(`Se aplicaron ${money(value)} correctamente.`); setTargetId(""); await loadOperations(); } catch (e) { setMessage(e instanceof Error ? e.message : "Error al aplicar"); } finally { setBusy(false); } }
  async function pay(id: string) { const value = Number(window.prompt("Valor del abono:", "")); if (!Number.isFinite(value) || value <= 0) return; const endpoint = tab === "customer" ? "/api/finance/receivables" : "/api/finance/payables"; setBusy(true); try { const r = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ id, amount: value, paymentMethod: method }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "No se pudo registrar"); setMessage(`Abono de ${money(value)} registrado.`); await Promise.all([loadOperations(), loadAnalytics()]); } catch (e) { setMessage(e instanceof Error ? e.message : "Error al registrar abono"); } finally { setBusy(false); } }

  return <main className="space-y-6 p-4 sm:p-6">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2 text-sm text-muted-foreground"><WalletCards className="h-4 w-4" /> Finanzas / Fase 5</div><h1 className="mt-1 text-2xl font-bold">Cartera, caja y rentabilidad</h1><p className="text-sm text-muted-foreground">CxC, CxP, anticipos, flujo de caja, utilidad neta y rentabilidad.</p></div><Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />Actualizar todo</Button></header>
    <div className="flex flex-wrap gap-2"><Button variant={section === "operations" ? "default" : "outline"} onClick={() => setSection("operations")}>Operaciones CxC/CxP</Button><Button variant={section === "analytics" ? "default" : "outline"} onClick={() => setSection("analytics")}>Flujo y rentabilidad</Button></div>

    {section === "operations" ? <>
      <div className="flex gap-2"><Button variant={tab === "customer" ? "default" : "outline"} onClick={() => setTab("customer")}>CxC · Clientes</Button><Button variant={tab === "supplier" ? "default" : "outline"} onClick={() => setTab("supplier")}>CxP · Proveedores</Button><Button variant="outline" onClick={() => void loadOperations()} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button></div>
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]"><section className="rounded-2xl border bg-card/80 p-5 shadow-sm"><h2 className="mb-4 font-semibold">Nuevo anticipo</h2><div className="space-y-3"><select value={partyId} onChange={e => { setPartyId(e.target.value); setTargetId(""); }} className="h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="">Seleccionar {tab === "customer" ? "cliente" : "proveedor"}</option>{parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><Input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Valor" /><select value={method} onChange={e => setMethod(e.target.value)} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">{methods.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select><Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Referencia opcional" /><Button className="w-full bg-amber-600 hover:bg-amber-700" disabled={busy || !partyId || !amount} onClick={() => void postAdvance()}>Registrar anticipo</Button></div></section>
      <section className="rounded-2xl border bg-card/80 p-5 shadow-sm"><h2 className="mb-1 font-semibold">Cuentas abiertas</h2><p className="mb-3 text-xs text-muted-foreground">{filtered.length} cuentas disponibles.</p><select value={targetId} onChange={e => setTargetId(e.target.value)} className="mb-4 h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="">Seleccionar cuenta para aplicar anticipo</option>{filtered.map(a => <option key={a._id} value={a._id}>{a.orderNumber || a.reference || a._id.slice(-8)} · {money(a.amountDue)}</option>)}</select><div className="space-y-2">{filtered.slice(0, 25).map(a => <div key={a._id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="font-medium">{a.orderNumber || a.reference || "Cuenta"}</p><p className="text-xs text-muted-foreground">{tab === "customer" ? (a.clientName || "Cliente") : (a.supplierName || "Proveedor")} · vence {a.dueDate ? new Date(a.dueDate).toLocaleDateString("es-CO") : "sin fecha"}</p></div><div className="flex items-center gap-3"><strong>{money(a.amountDue)}</strong><Button size="sm" variant="outline" disabled={busy} onClick={() => void pay(a._id)}>Abonar</Button></div></div>)}{!filtered.length && <p className="py-8 text-center text-sm text-muted-foreground">No hay cuentas abiertas.</p>}</div></section></div>
      <section className="rounded-2xl border bg-card/80 p-5 shadow-sm"><h2 className="mb-4 font-semibold">Anticipos disponibles</h2><div className="space-y-2">{advances.map(a => <div key={a._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><p className="font-medium">{a.partyName} <span className="text-xs font-normal text-muted-foreground">· {a.type === "customer" ? "Cliente" : "Proveedor"}</span></p><p className="text-xs text-muted-foreground">{a.reference || "Sin referencia"}</p></div><div className="flex items-center gap-3"><strong>{money(a.amountAvailable)}</strong><Button size="sm" disabled={busy || !targetId || partyId !== a.partyId} onClick={() => void applyAdvance(a)}>Aplicar anticipo</Button></div></div>)}{!advances.length && <p className="py-8 text-center text-sm text-muted-foreground">No hay anticipos disponibles.</p>}</div></section>
    </> : <>
      <section className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card/80 p-4 shadow-sm"><label className="text-xs text-muted-foreground">Desde<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 block h-9 rounded-lg border bg-background px-2 text-sm" /></label><label className="text-xs text-muted-foreground">Hasta<input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 block h-9 rounded-lg border bg-background px-2 text-sm" /></label><Button variant="outline" onClick={() => void loadAnalytics()} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" />Recalcular</Button></section>
      {report && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Metric icon={TrendingUp} label="Ingresos" value={report.revenue.total} /><Metric icon={Banknote} label="Flujo neto de caja" value={report.cash.balance} /><Metric icon={BarChart3} label="Utilidad bruta" value={report.grossProfit.total} note={`${report.grossProfit.margin.toFixed(1)}% margen`} /><Metric icon={TrendingDown} label="Gastos operativos" value={operatingExpenses} /><Metric icon={CircleDollarSign} label="Utilidad neta" value={netProfit} note="Utilidad bruta − gastos" /></div>}
      {report && <section className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border p-5"><p className="text-sm text-muted-foreground">Entradas de caja</p><p className="mt-1 text-xl font-bold">{money(report.cash.income)}</p><p className="mt-2 text-xs text-muted-foreground">Cobros y otros ingresos registrados.</p></div><div className="rounded-2xl border p-5"><p className="text-sm text-muted-foreground">Salidas de caja</p><p className="mt-1 text-xl font-bold">{money(report.cash.expense)}</p><p className="mt-2 text-xs text-muted-foreground">Incluye gastos y pagos registrados.</p></div><div className="rounded-2xl border p-5"><p className="text-sm text-muted-foreground">Conciliación</p><p className="mt-1 text-xl font-bold">{report.reconciliation.status === "balanced" ? "Equilibrada" : "Revisar"}</p><p className="mt-2 text-xs text-muted-foreground">Diferencia: {money(report.reconciliation.difference)}</p></div></section>}
      <ProfitTable title="Rentabilidad por producto" headers={["Producto", "Unidades", "Ventas", "Costo", "Utilidad", "Margen"]} rows={productProfitability.map(r => [r.name, String(r.qty), money(r.revenue), money(r.cost), money(r.profit), `${r.margin.toFixed(1)}%`])} empty="No hay ventas de productos en el período." />
      <ProfitTable title="Rentabilidad por servicio" headers={["Servicio", "Ingresos", "Costo repuestos", "Utilidad", "Margen"]} rows={serviceProfitability.map(r => [r.id.slice(-8), money(r.revenue), money(r.cost), money(r.profit), `${r.margin.toFixed(1)}%`])} empty="No hay servicios en el período." />
      <ProfitTable title="Rentabilidad por vendedor" headers={["Vendedor / usuario", "Ventas", "Costo", "Utilidad", "Margen", "Órdenes"]} rows={sellerProfitability.map(r => [r.seller === "usuario actual" ? r.seller : r.seller.slice(-8), money(r.revenue), money(r.cost), money(r.profit), `${r.margin.toFixed(1)}%`, String(r.orders)])} empty="No hay ventas asignables a vendedor en el período." />
      <ProfitTable title="Rentabilidad por período" headers={["Período", "Ingresos", "Costo", "Utilidad", "Margen"]} rows={periodProfitability.map(r => [r.period, money(r.revenue), money(r.cost), money(r.profit), `${r.margin.toFixed(1)}%`])} empty="No hay actividad en el período." />
      <section className="rounded-2xl border bg-card/80 p-5 shadow-sm"><div className="mb-3 flex items-center gap-2"><CalendarDays className="h-4 w-4" /><h2 className="font-semibold">Resumen de gastos</h2></div><div className="space-y-2">{Object.entries(periodExpenses.reduce<Record<string, number>>((m, e) => { const k = e.category || "General"; m[k] = (m[k] || 0) + Number(e.amount || 0); return m; }, {})).sort((a,b) => b[1]-a[1]).map(([k,v]) => <div key={k} className="flex justify-between rounded-xl border p-3"><span>{k}</span><strong>{money(v)}</strong></div>)}{!periodExpenses.length && <p className="py-6 text-center text-sm text-muted-foreground">No hay gastos en el período.</p>}</div></section>
    </>}
    {message && <div className="rounded-xl border bg-muted/40 p-3 text-sm">{message}</div>}
  </main>;
}

function Metric({ icon: Icon, label, value, note }: { icon: typeof TrendingUp; label: string; value: number; note?: string }) { return <div className="rounded-2xl border bg-card/80 p-5 shadow-sm"><div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" />{label}</div><p className="text-xl font-bold sm:text-2xl">{money(value)}</p>{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}</div>; }
function ProfitTable({ title, headers, rows, empty }: { title: string; headers: string[]; rows: string[][]; empty: string }) { return <section className="rounded-2xl border bg-card/80 p-5 shadow-sm"><h2 className="mb-4 font-semibold">{title}</h2>{rows.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground">{headers.map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-b last:border-0">{row.map((cell, j) => <td key={j} className={`px-3 py-3 ${j >= 2 ? "text-right" : ""}`}>{cell}</td>)}</tr>)}</tbody></table></div> : <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>}</section>; }
