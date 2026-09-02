"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Clock3, ShieldCheck, Truck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const statuses = { received: "Recibido", diagnosis: "Diagnóstico", awaiting_approval: "Esperando aprobación", repairing: "En reparación", ready: "Listo", delivered: "Entregado", cancelled: "Cancelado" } as const;
type Status = keyof typeof statuses;
type HistoryItem = { status: Status; at: string; by?: string };
type Data = { status: Status; estimatedDelivery?: string | null; deliveredAt?: string | null; warrantyDays: number; warrantyExpiresAt?: string | null; notes?: string | null; statusHistory: HistoryItem[] };

const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—";
const inputDate = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 16) : "";

export default function ServiceOrderLifecyclePanel({ orderId }: { orderId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<Status>("received");
  const [estimatedDelivery, setEstimatedDelivery] = useState("");
  const [warrantyDays, setWarrantyDays] = useState("0");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      const response = await fetch(`/api/service-orders?search=${encodeURIComponent(orderId)}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "No se pudo cargar el ciclo de vida");
      const found = (json.orders || []).find((item: any) => item._id === orderId || item.orderNumber === orderId);
      if (!found) throw new Error("Orden no encontrada");
      const next: Data = { status: found.status, estimatedDelivery: found.estimatedDelivery, deliveredAt: found.deliveredAt, warrantyDays: Number(found.warrantyDays || 0), warrantyExpiresAt: found.warrantyUntil || found.warrantyExpiresAt, notes: found.notes, statusHistory: Array.isArray(found.statusHistory) ? found.statusHistory : [] };
      setData(next); setStatus(next.status); setEstimatedDelivery(inputDate(next.estimatedDelivery)); setWarrantyDays(String(next.warrantyDays)); setNotes(next.notes || "");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo cargar el ciclo de vida"); }
  };

  useEffect(() => { void load(); }, [orderId]);

  const save = async () => {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/service-orders/lifecycle", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: orderId, status, estimatedDelivery: estimatedDelivery || null, warrantyDays: Number(warrantyDays || 0), notes }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "No se pudo guardar");
      setData(json); setMessage("Ciclo de vida actualizado correctamente.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar"); }
    finally { setSaving(false); }
  };

  const timeline = useMemo(() => (data?.statusHistory || []).slice(-10).reverse(), [data]);
  const warrantyText = data?.warrantyExpiresAt ? `Vence ${dateLabel(data.warrantyExpiresAt)}` : data?.warrantyDays ? `${data.warrantyDays} días desde la entrega` : "Sin garantía configurada";

  if (!data) return <Card><CardContent className="p-5 text-sm text-muted-foreground">{message || "Cargando ciclo de vida…"}</CardContent></Card>;

  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" />Ciclo de vida de la reparación</CardTitle>
      <CardDescription>Controla el estado, fecha prometida, entrega y garantía sin perder el historial.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2 lg:col-span-2"><Label>Estado actual</Label><select value={status} onChange={e => setStatus(e.target.value as Status)} disabled={data.status === "delivered" || data.status === "cancelled"} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="received">Recibido</option><option value="diagnosis">Diagnóstico</option><option value="awaiting_approval">Esperando aprobación</option><option value="repairing">En reparación</option><option value="ready">Listo</option><option value="delivered">Entregado</option><option value="cancelled">Cancelado</option></select></div>
        <div className="space-y-2"><Label>Entrega estimada</Label><Input type="datetime-local" value={estimatedDelivery} onChange={e => setEstimatedDelivery(e.target.value)} disabled={data.status === "delivered" || data.status === "cancelled"} /></div>
        <div className="space-y-2"><Label>Garantía (días)</Label><Input type="number" min="0" max="3650" value={warrantyDays} onChange={e => setWarrantyDays(e.target.value)} disabled={data.status === "cancelled"} /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Info icon={Truck} label="Entrega estimada" value={dateLabel(data.estimatedDelivery)} />
        <Info icon={CheckCircle2} label="Entregado" value={dateLabel(data.deliveredAt)} />
        <Info icon={ShieldCheck} label="Garantía" value={warrantyText} />
      </div>
      <div className="space-y-2"><Label>Notas internas de seguimiento</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={4000} rows={3} placeholder="Ej.: cliente avisado, repuesto pendiente, equipo listo para recoger…" /></div>
      <div className="flex flex-wrap items-center gap-3"><Button onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : "Guardar ciclo de vida"}</Button>{message && <span className="text-sm text-muted-foreground">{message}</span>}</div>
      <div><div className="mb-3 flex items-center gap-2"><Clock3 className="h-4 w-4" /><p className="text-sm font-medium">Historial de estados</p></div><div className="space-y-2">{timeline.length === 0 ? <p className="text-sm text-muted-foreground">Sin cambios de estado registrados.</p> : timeline.map((item, index) => <div key={`${item.at}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"><div className="flex min-w-0 items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full bg-current opacity-50" /><span className="truncate text-sm font-medium">{statuses[item.status] || item.status}</span></div><Badge variant="outline">{dateLabel(item.at)}</Badge></div>)}</div></div>
    </CardContent>
  </Card>;
}

function Info({ icon: Icon, label, value }: { icon: typeof Truck; label: string; value: string }) {
  return <div className="rounded-xl border p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" />{label}</div><p className="mt-1 text-sm font-semibold">{value}</p></div>;
}
