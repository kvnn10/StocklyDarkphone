"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardCheck, UserRound, Wrench } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const statuses = { received: "Recibido", diagnosis: "Diagnóstico", awaiting_approval: "Esperando aprobación", repairing: "En reparación", ready: "Listo", delivered: "Entregado", cancelled: "Cancelado" } as const;
type Status = keyof typeof statuses;
type Order = { _id: string; orderNumber: string; customer: string; phone: string; device: string; imei?: string; serial?: string; issue: string; status: Status; diagnosis?: string; technicianNotes?: string; total: number; paid: number; balance: number };

export default function ServiceOrderDetail({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [diagnosis, setDiagnosis] = useState("");
  const [technicianNotes, setTechnicianNotes] = useState("");
  const [status, setStatus] = useState<Status>("received");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/service-orders?search=${encodeURIComponent(orderId)}`, { cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "No se pudo cargar la orden"); const found = data.orders?.find((item: Order) => item._id === orderId || item.orderNumber === orderId); if (!found) throw new Error("Orden no encontrada"); setOrder(found); setDiagnosis(found.diagnosis || ""); setTechnicianNotes(found.technicianNotes || ""); setStatus(found.status); })
      .catch(error => setMessage(error instanceof Error ? error.message : "No se pudo cargar la orden"));
  }, [orderId]);

  const save = async () => {
    if (!order) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/service-orders", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: order._id, diagnosis, technicianNotes, status }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar");
      setOrder(data); setMessage("Orden actualizada correctamente.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar"); } finally { setSaving(false); }
  };

  if (!order) return <main className="p-6"><Link href="/admin/service-orders"><Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" />Volver</Button></Link><div className="mt-6 rounded-lg border p-6 text-sm text-muted-foreground">{message || "Cargando orden..."}</div></main>;

  return <main className="space-y-6 p-2 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/admin/service-orders"><Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" />Servicio técnico</Button></Link><Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar cambios"}</Button></div>
    <div><h1 className="text-2xl font-semibold">{order.orderNumber}</h1><p className="text-sm text-muted-foreground">Detalle de reparación</p></div>
    <div className="grid gap-4 md:grid-cols-2">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5" />Cliente y equipo</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p><b>Cliente:</b> {order.customer}</p><p><b>Teléfono:</b> {order.phone}</p><p><b>Equipo:</b> {order.device}</p><p><b>IMEI:</b> {order.imei || "—"}</p><p><b>Serial:</b> {order.serial || "—"}</p><p><b>Falla reportada:</b> {order.issue}</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" />Estado y técnico</CardTitle></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label>Estado</Label><Select value={status} onValueChange={value => setStatus(value as Status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(statuses).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="technician">Técnico / notas de reparación</Label><Input id="technician" value={technicianNotes} onChange={event => setTechnicianNotes(event.target.value)} placeholder="Técnico responsable y trabajo realizado" /></div></CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" />Diagnóstico</CardTitle></CardHeader><CardContent className="space-y-2"><Label htmlFor="diagnosis">Diagnóstico técnico</Label><Textarea id="diagnosis" value={diagnosis} onChange={event => setDiagnosis(event.target.value)} placeholder="Resultado de la revisión técnica" rows={6} /></CardContent></Card>
    <Card><CardHeader><CardTitle>Resumen económico</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-3 text-sm"><p><span className="text-muted-foreground">Total</span><br /><b>${Number(order.total || 0).toLocaleString("es-CO")}</b></p><p><span className="text-muted-foreground">Pagado</span><br /><b>${Number(order.paid || 0).toLocaleString("es-CO")}</b></p><p><span className="text-muted-foreground">Saldo</span><br /><b>${Number(order.balance || 0).toLocaleString("es-CO")}</b></p></CardContent></Card>
    {message && <div className="rounded-lg border p-3 text-sm">{message}</div>}
  </main>;
}
