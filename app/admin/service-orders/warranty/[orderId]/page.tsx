"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Part = { id: string; name: string; warrantyDays?: number; warrantyUntil?: string | null };
type Order = { _id: string; orderNumber: string; customer: string; device: string; imei?: string; serial?: string; status: string; parts?: Part[]; warrantyDays?: number; warrantyUntil?: string | null };

export default function WarrantyReentryPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;
  const [order, setOrder] = useState<Order | null>(null);
  const [partId, setPartId] = useState("");
  const [issue, setIssue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/service-orders", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo cargar la orden");
        const found = data.orders?.find((item: Order) => item._id === orderId || item.orderNumber === orderId);
        if (!found) throw new Error("Orden original no encontrada");
        if (found.status !== "delivered") throw new Error("La orden debe estar entregada para ingresar por garantía");
        setOrder(found);
        const eligible = (found.parts || []).filter((part: Part) => !part.warrantyUntil || new Date(part.warrantyUntil).getTime() >= Date.now());
        if (eligible.length) setPartId(eligible[0].id);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "No se pudo cargar la orden");
      } finally { setLoading(false); }
    };
    void load();
  }, [orderId]);

  const submit = async () => {
    if (!order || !issue.trim()) { setMessage("Describe la falla que presenta el equipo."); return; }
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/service-orders/warranty-reentry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ originalOrderId: order._id, warrantyPartId: partId, issue: issue.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear el reingreso");
      router.push(`/admin/service-orders/${data._id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear el reingreso");
    } finally { setSaving(false); }
  };

  if (loading) return <main className="p-6 text-sm text-muted-foreground">Cargando garantía...</main>;
  if (!order) return <main className="space-y-4 p-6"><Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4" />Volver</Button><div className="rounded-lg border p-4 text-sm">{message || "Orden no encontrada"}</div></main>;

  const eligibleParts = (order.parts || []).filter(part => !part.warrantyUntil || new Date(part.warrantyUntil).getTime() >= Date.now());
  return <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
    <div className="flex items-center gap-3"><Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4" />Volver</Button><div><h1 className="text-2xl font-semibold">Reingreso por garantía</h1><p className="text-sm text-muted-foreground">Orden original {order.orderNumber}</p></div></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Garantía</CardTitle></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 text-sm"><p><b>Cliente:</b> {order.customer}</p><p><b>Equipo:</b> {order.device}</p><p><b>IMEI:</b> {order.imei || "—"}</p><p><b>Serial:</b> {order.serial || "—"}</p></div>
      <div className="space-y-2"><Label>Repuesto cubierto</Label>{eligibleParts.length ? <Select value={partId} onValueChange={setPartId}><SelectTrigger><SelectValue placeholder="Selecciona el repuesto" /></SelectTrigger><SelectContent>{eligibleParts.map(part => <SelectItem key={part.id} value={part.id}>{part.name}{part.warrantyDays ? ` · ${part.warrantyDays} días` : ""}</SelectItem>)}</SelectContent></Select> : <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No hay repuestos con garantía vigente asociados a esta orden.</div>}</div>
      <div className="space-y-2"><Label>Falla reportada para el reingreso</Label><Textarea value={issue} onChange={e => setIssue(e.target.value)} placeholder="Ej.: La pantalla presenta líneas después de 30 días..." rows={5} /></div>
      {message && <div className="rounded-lg border p-3 text-sm">{message}</div>}
      <div className="flex justify-end"><Button disabled={saving || !issue.trim() || !eligibleParts.length} onClick={() => void submit()}>{saving ? "Creando reingreso..." : "Crear reingreso por garantía"}</Button></div>
    </CardContent></Card>
  </main>;
}
