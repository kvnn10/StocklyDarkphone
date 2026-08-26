"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, RefreshCw, FileDown, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Product = { id: string; name: string; sku?: string; price: number; quantity?: number; status?: string };
type Client = { id: string; name: string; email?: string; phone?: string; whatsapp?: string };
type QuoteItem = { productId: string; name: string; quantity: number; unitPrice: number };
type Quote = { _id: string; quoteNumber: string; customerName: string; customerPhone?: string; customerEmail?: string; total: number; subtotal: number; discount: number; status: string; validUntil?: string | null; items?: QuoteItem[]; notes?: string; createdAt: string; convertedOrderNumber?: string; convertedInvoiceNumber?: string };

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-CO")}`;
const statusLabel: Record<string, string> = { draft: "Borrador", sent: "Enviada", accepted: "Aceptada", rejected: "Rechazada", expired: "Vencida", converted: "Convertida" };

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [qr, pr, cr] = await Promise.all([
        fetch(`/api/quotes?search=${encodeURIComponent(search)}`, { cache: "no-store" }),
        fetch("/api/products", { cache: "no-store" }),
        fetch("/api/clients", { cache: "no-store" }),
      ]);
      const qd = await qr.json(); const pd = await pr.json(); const cd = await cr.json();
      if (qr.ok) setQuotes(qd.quotes || []);
      if (pr.ok) setProducts(Array.isArray(pd) ? pd : pd.products || []);
      if (cr.ok) setClients(Array.isArray(cd) ? cd : cd.clients || []);
    } catch { setMessage("No se pudieron cargar los datos."); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  const subtotal = useMemo(() => items.reduce((s, i) => s + i.quantity * i.unitPrice, 0), [items]);
  const discountValue = Math.max(0, Number(discount || 0));
  const total = Math.max(0, subtotal - discountValue);
  const productMatches = products.filter(p => `${p.name} ${p.sku || ""}`.toLowerCase().includes(itemSearch.toLowerCase())).slice(0, 8);

  const selectClient = (id: string) => { setCustomerId(id); const c = clients.find(x => x.id === id); if (c) { setName(c.name); setPhone(c.phone || c.whatsapp || ""); setEmail(c.email || ""); } };
  const addProduct = (p: Product) => { setItems(current => { const found = current.find(i => i.productId === p.id); if (found) return current.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i); return [...current, { productId: p.id, name: p.name, quantity: 1, unitPrice: Number(p.price || 0) }]; }); setItemSearch(""); };
  const updateQty = (productId: string, quantity: number) => setItems(current => current.map(i => i.productId === productId ? { ...i, quantity: Math.max(1, quantity) } : i));
  const updatePrice = (productId: string, unitPrice: number) => setItems(current => current.map(i => i.productId === productId ? { ...i, unitPrice: Math.max(0, unitPrice) } : i));
  const removeItem = (productId: string) => setItems(current => current.filter(i => i.productId !== productId));
  const reset = () => { setCustomerId(""); setName(""); setPhone(""); setEmail(""); setItems([]); setDiscount(""); setNotes(""); setValidUntil(""); };

  const create = async () => {
    if (!name.trim() || !items.length) return;
    setSaving(true); setMessage("");
    try { const r = await fetch("/api/quotes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customerId: customerId || undefined, customerName: name, customerPhone: phone, customerEmail: email, notes, validUntil, discount: discountValue, items }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "No se pudo crear la cotización"); setMessage(`Cotización ${d.quoteNumber} creada correctamente por ${money(d.total)}.`); reset(); await load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo crear la cotización"); } finally { setSaving(false); }
  };

  const changeStatus = async (id: string, status: string) => { const r = await fetch("/api/quotes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) }); if (r.ok) await load(); else setMessage("No se pudo actualizar el estado."); };

  const printQuote = (q: Quote) => {
    const rows = (q.items || []).map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${i.quantity}</td><td>${money(i.unitPrice)}</td><td>${money(i.quantity * i.unitPrice)}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(q.quoteNumber)}</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#111}h1{margin:0 0 4px}small{color:#666}.head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:20px}.client{margin:28px 0}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border-bottom:1px solid #ddd;padding:10px;text-align:left}th{background:#f5f5f5}.num{text-align:right}.totals{margin:25px 0 0 auto;width:280px}.totals div{display:flex;justify-content:space-between;padding:5px}.grand{border-top:2px solid #111;margin-top:8px;padding-top:10px;font-size:18px;font-weight:bold}.notes{margin-top:30px;padding:15px;background:#f7f7f7}@media print{body{padding:0}}</style></head><body><div class="head"><div><h1>DARKPHONE</h1><small>Cotización ${escapeHtml(q.quoteNumber)}</small></div><div><b>Vigencia</b><br>${q.validUntil ? new Date(q.validUntil).toLocaleDateString("es-CO") : "Sin fecha"}</div></div><div class="client"><b>Cliente</b><br>${escapeHtml(q.customerName)}<br>${escapeHtml(q.customerPhone || "")} ${q.customerEmail ? `· ${escapeHtml(q.customerEmail)}` : ""}</div><table><thead><tr><th>Producto / servicio</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div><span>Subtotal</span><b>${money(q.subtotal)}</b></div><div><span>Descuento</span><b>${money(q.discount)}</b></div><div class="grand"><span>Total</span><b>${money(q.total)}</b></div></div>${q.notes ? `<div class="notes"><b>Notas</b><br>${escapeHtml(q.notes)}</div>` : ""}<p style="margin-top:40px;color:#666;font-size:12px">Documento generado desde Stockly · Cotización no constituye factura hasta su conversión.</p><script>window.onload=()=>window.print()</script></body></html>`;
    const w = window.open("", "_blank", "noopener,noreferrer"); if (w) { w.document.write(html); w.document.close(); }
  };

  const convert = async (q: Quote) => {
    if (!confirm(`¿Convertir ${q.quoteNumber} en venta/factura? Se reservará y consumirá inventario según el flujo de venta.`)) return;
    setSaving(true); setMessage("");
    try { const r = await fetch("/api/quotes/convert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: q._id }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "No se pudo convertir"); setMessage(`${q.quoteNumber} convertida: ${d.orderNumber} · ${d.invoiceNumber}.`); await load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo convertir la cotización"); } finally { setSaving(false); }
  };

  return <main className="space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">Cotizaciones</h1><p className="text-sm text-muted-foreground">Presupuestos con productos reales, clientes y totales en tiempo real.</p></div><Button variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Actualizar</Button></div>
    {message && <div className="rounded-md border p-3 text-sm">{message}</div>}

    <Card><CardHeader><CardTitle>Nueva cotización</CardTitle></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3"><div className="md:col-span-2"><Label>Cliente</Label><select value={customerId} onChange={e => selectClient(e.target.value)} className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm"><option value="">Seleccionar cliente o escribir abajo</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}</select></div><div><Label>Válida hasta</Label><Input className="mt-1" type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></div><div><Label>Nombre del cliente</Label><Input className="mt-1" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre" /></div><div><Label>Teléfono</Label><Input className="mt-1" value={phone} onChange={e => setPhone(e.target.value)} placeholder="300..." /></div><div><Label>Correo</Label><Input className="mt-1" value={email} onChange={e => setEmail(e.target.value)} placeholder="cliente@email.com" /></div></div>
      <div><Label>Agregar productos / servicios</Label><div className="relative mt-1"><div className="flex items-center gap-2"><Search className="h-4 w-4 text-muted-foreground" /><Input value={itemSearch} onChange={e => setItemSearch(e.target.value)} placeholder="Buscar por nombre o SKU..." /></div>{itemSearch && <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-lg">{productMatches.map(p => <button type="button" key={p.id} onClick={() => addProduct(p)} className="flex w-full items-center justify-between border-b p-3 text-left text-sm hover:bg-muted"><span><b>{p.name}</b><span className="ml-2 text-xs text-muted-foreground">{p.sku || "Sin SKU"}</span></span><span className="font-medium">{money(p.price)}</span></button>)}{!productMatches.length && <div className="p-3 text-sm text-muted-foreground">No encontramos productos.</div>}</div>}</div></div>
      {items.length > 0 && <div className="overflow-x-auto rounded-lg border"><div className="min-w-[700px]"><div className="grid grid-cols-[1fr_120px_120px_120px_45px] gap-3 border-b bg-muted/40 p-3 text-xs font-medium text-muted-foreground"><span>Producto / servicio</span><span>Cantidad</span><span>Precio venta</span><span>Total</span><span /></div>{items.map(i => <div key={i.productId} className="grid grid-cols-[1fr_120px_120px_120px_45px] items-center gap-3 border-b p-3 last:border-0"><span className="text-sm font-medium">{i.name}</span><Input type="number" min="1" value={i.quantity} onChange={e => updateQty(i.productId, Number(e.target.value))} /><Input type="number" min="0" value={i.unitPrice} onChange={e => updatePrice(i.productId, Number(e.target.value))} /><span className="text-sm font-semibold">{money(i.quantity * i.unitPrice)}</span><Button size="icon" variant="ghost" onClick={() => removeItem(i.productId)} aria-label="Eliminar"><Trash2 className="h-4 w-4" /></Button></div>)}</div></div>}
      <div className="grid gap-4 md:grid-cols-3"><div className="md:col-span-2"><Label>Notas</Label><Textarea className="mt-1" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Condiciones, garantía, instalación, observaciones..." /></div><div className="rounded-lg border p-4 text-sm"><div className="flex justify-between"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="mt-3 flex items-center justify-between gap-3"><span>Descuento</span><Input className="w-28" type="number" min="0" value={discount} onChange={e => setDiscount(e.target.value)} /></div><div className="my-3 border-t" /><div className="flex justify-between text-base"><span>Total</span><b>{money(total)}</b></div></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Se guardará como borrador.</span><Button onClick={() => void create()} disabled={saving || !name.trim() || !items.length}><Plus className="h-4 w-4" />{saving ? "Guardando..." : "Crear cotización"}</Button></div>
    </CardContent></Card>

    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Historial</CardTitle><Input className="w-full sm:w-72" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void load(); }} placeholder="Buscar cotización o cliente..." /></div></CardHeader><CardContent>{loading ? <p className="text-sm text-muted-foreground">Cargando...</p> : !quotes.length ? <p className="text-sm text-muted-foreground">No hay cotizaciones todavía.</p> : <div className="space-y-2">{quotes.map(q => <div key={q._id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><b>{q.quoteNumber}</b><div className="mt-1 text-sm text-muted-foreground">{q.customerName} · {statusLabel[q.status] || q.status}{q.validUntil ? ` · Válida hasta ${new Date(q.validUntil).toLocaleDateString("es-CO")}` : ""}</div>{q.convertedOrderNumber && <div className="mt-1 text-xs text-muted-foreground">Venta: {q.convertedOrderNumber} · Factura: {q.convertedInvoiceNumber}</div>}</div><b className="text-lg">{money(q.total)}</b></div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => printQuote(q)}><FileDown className="h-4 w-4" />PDF / Imprimir</Button>{q.status === "draft" && <Button size="sm" variant="outline" onClick={() => void changeStatus(q._id, "sent")}>Marcar enviada</Button>}{q.status === "sent" && <><Button size="sm" onClick={() => void changeStatus(q._id, "accepted")}>Aceptar</Button><Button size="sm" variant="outline" onClick={() => void changeStatus(q._id, "rejected")}>Rechazar</Button></>}{q.status === "accepted" && <Button size="sm" onClick={() => void convert(q)} disabled={saving}><ArrowRight className="h-4 w-4" />Convertir en venta</Button>}{q.status === "converted" && <span className="rounded-full border px-3 py-1 text-xs">Venta y factura creadas</span>}</div></div>)}</div>}</CardContent></Card>
  </main>;
}

function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[c] || c)); }
