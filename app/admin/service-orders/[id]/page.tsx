"use client";

import ServiceOrderDetail from "@/components/admin/ServiceOrderDetail";
import ServiceOrderPhotoEvidence from "@/components/admin/ServiceOrderPhotoEvidence";
import { useEffect, useState } from "react";
import { ShieldCheck, History, CalendarDays, Smartphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type HistoryOrder = { _id: string; orderNumber: string; device: string; issue: string; status: string; total: number; paid: number; balance: number; createdAt: string; deliveredAt?: string; warrantyDays?: number; warrantyUntil?: string | null; warrantyNote?: string; imei?: string; serial?: string };
const statusLabel: Record<string, string> = { received: "Recibido", diagnosis: "Diagnóstico", awaiting_approval: "Esperando aprobación", repairing: "En reparación", ready: "Listo", delivered: "Entregado", cancelled: "Cancelado" };
const money = (value: number) => `$${Number(value || 0).toLocaleString("es-CO")}`;

function WarrantyHistory({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<HistoryOrder | null>(null), [history, setHistory] = useState<HistoryOrder[]>([]), [days, setDays] = useState("90"), [note, setNote] = useState("Garantía sobre la reparación realizada."), [saving, setSaving] = useState(false), [message, setMessage] = useState("");
  const load = async () => { try { const response = await fetch(`/api/service-orders/warranty?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "No se pudo cargar la garantía"); setOrder(data.order); setHistory(data.history || []); setDays(String(data.order.warrantyDays ?? 90)); setNote(data.order.warrantyNote || "Garantía sobre la reparación realizada."); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo cargar la garantía"); } };
  useEffect(() => { void load(); }, [orderId]);
  const save = async () => { setSaving(true); setMessage(""); try { const response = await fetch("/api/service-orders/warranty", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, warrantyDays: Number(days || 0), warrantyNote: note }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "No se pudo guardar la garantía"); setOrder(data); setMessage("Garantía guardada correctamente."); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar la garantía"); } finally { setSaving(false); } };
  const active = order?.warrantyUntil ? new Date(order.warrantyUntil) >= new Date() : false;
  return <div className="space-y-6 px-2 pb-8 sm:px-4">
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Garantía de la reparación</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 md:grid-cols-3"><div><label className="text-sm font-medium">Días de garantía</label><Input type="number" min="0" max="3650" value={days} onChange={e => setDays(e.target.value)} className="mt-2" /></div><div className="md:col-span-2"><label className="text-sm font-medium">Condiciones / nota</label><Textarea value={note} onChange={e => setNote(e.target.value)} className="mt-2" rows={2} /></div></div><div className="flex flex-wrap items-center gap-3"><Button disabled={saving || order?.status !== "delivered"} onClick={() => void save()}><ShieldCheck className="mr-2 h-4 w-4" />{saving ? "Guardando..." : "Activar / actualizar garantía"}</Button>{order?.warrantyUntil && <span className={`rounded-full border px-3 py-1 text-sm ${active ? "text-emerald-600" : "text-muted-foreground"}`}>{active ? "Garantía vigente" : "Garantía vencida"} · vence {new Date(order.warrantyUntil).toLocaleDateString("es-CO")}</span>}{order?.status !== "delivered" && <span className="text-xs text-muted-foreground">La garantía se activa al marcar la reparación como entregada.</span>}</div>{message && <p className="text-sm text-muted-foreground">{message}</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Historial del equipo</CardTitle></CardHeader><CardContent className="space-y-3">{order && <div className="mb-3 rounded-lg border p-3 text-sm"><p className="flex items-center gap-2 font-medium"><Smartphone className="h-4 w-4" />{order.device}</p><p className="mt-1 text-xs text-muted-foreground">IMEI: {order.imei || "—"} · Serial: {order.serial || "—"}</p></div>}{history.length === 0 ? <p className="py-5 text-center text-sm text-muted-foreground">No hay reparaciones anteriores asociadas a este IMEI/serial.</p> : history.map(item => <div key={item._id} className="rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{item.orderNumber} · {item.device}</p><p className="text-xs text-muted-foreground"><CalendarDays className="mr-1 inline h-3 w-3" />{item.createdAt ? new Date(item.createdAt).toLocaleDateString("es-CO") : "—"} · {statusLabel[item.status] || item.status}</p></div><span className="font-semibold">{money(item.total)}</span></div><p className="mt-2 text-sm text-muted-foreground">{item.issue}</p>{item.warrantyUntil && <p className="mt-2 text-xs">Garantía: {new Date(item.warrantyUntil) >= new Date() ? `vigente hasta ${new Date(item.warrantyUntil).toLocaleDateString("es-CO")` : `vencida el ${new Date(item.warrantyUntil).toLocaleDateString("es-CO")}`}</p>}</div>)}</CardContent></Card>
  </div>;
}

export default async function ServiceOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <ServiceOrderDetail orderId={id} />
      <WarrantyHistory orderId={id} />
      <div className="px-2 pb-8 sm:px-4">
        <ServiceOrderPhotoEvidence orderId={id} />
      </div>
    </>
  );
}
