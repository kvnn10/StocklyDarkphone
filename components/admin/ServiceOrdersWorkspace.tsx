"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wrench, Smartphone, UserRound, ClipboardList, CircleDollarSign, Camera, ImagePlus, Loader2, Trash2, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { PageSectionHeader } from "@/components/shared/PageSectionHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const statusLabels = { received: "Recibido", diagnosis: "Diagnóstico", awaiting_approval: "Esperando aprobación", repairing: "En reparación", ready: "Listo", delivered: "Entregado", cancelled: "Cancelado" } as const;
type Status = keyof typeof statusLabels;
type Order = { _id: string; orderNumber: string; customer: string; phone: string; device: string; imei?: string; serial?: string; issue: string; status: Status; total: number; paid: number; balance: number };
type Stats = { open: number; repairing: number; awaitingApproval: number; pendingBalance: number };
type IntakePhoto = { id: string; dataUrl: string; filename: string };
const statCards: { icon: LucideIcon; label: string; key: keyof Stats }[] = [
  { icon: ClipboardList, label: "Órdenes abiertas", key: "open" }, { icon: Smartphone, label: "En reparación", key: "repairing" }, { icon: UserRound, label: "Pendientes de aprobación", key: "awaitingApproval" }, { icon: CircleDollarSign, label: "Saldo pendiente", key: "pendingBalance" },
];

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la fotografía"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("No se pudo procesar la fotografía"));
      image.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("No se pudo preparar la fotografía"));
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL("image/jpeg", 0.72);
        if (result.length > 900000) return reject(new Error("La fotografía es demasiado grande incluso comprimida"));
        resolve(result);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function ServiceOrdersWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("received"); const [search, setSearch] = useState(""); const [customer, setCustomer] = useState(""); const [phone, setPhone] = useState(""); const [device, setDevice] = useState(""); const [imei, setImei] = useState(""); const [issue, setIssue] = useState(""); const [intakePhotos, setIntakePhotos] = useState<IntakePhoto[]>([]); const [orders, setOrders] = useState<Order[]>([]); const [stats, setStats] = useState<Stats>({ open: 0, repairing: 0, awaitingApproval: 0, pendingBalance: 0 }); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [uploadingPhoto, setUploadingPhoto] = useState(false); const [message, setMessage] = useState(""); const [preview, setPreview] = useState<IntakePhoto | null>(null);
  const draftReady = useMemo(() => Boolean(customer.trim() && phone.trim() && device.trim() && issue.trim()), [customer, phone, device, issue]);
  const load = useCallback(async () => { setLoading(true); try { const params = new URLSearchParams(); if (search.trim()) params.set("search", search.trim()); const response = await fetch(`/api/service-orders?${params}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "No se pudieron cargar las órdenes"); setOrders(data.orders ?? []); setStats(data.stats ?? { open: 0, repairing: 0, awaitingApproval: 0, pendingBalance: 0 }); } catch (error) { setMessage(error instanceof Error ? error.message : "Error al cargar órdenes"); } finally { setLoading(false); } }, [search]);
  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [load]);

  const addIntakePhotos = async (files: File[]) => {
    setUploadingPhoto(true); setMessage("");
    try {
      for (const file of files) {
        if (intakePhotos.length >= 12) break;
        if (!file.type.startsWith("image/")) continue;
        const dataUrl = await compressImage(file);
        setIntakePhotos(current => current.length >= 12 ? current : [...current, { id: `${Date.now()}-${Math.random()}`, dataUrl, filename: file.name }]);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo preparar la fotografía"); }
    finally { setUploadingPhoto(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const createOrder = async () => { if (!draftReady) return; setSaving(true); setMessage(""); try { const response = await fetch("/api/service-orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer, phone, device, imei, issue, status, total: 0, paid: 0 }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "No se pudo crear la orden");
      let photoError = "";
      for (const photo of intakePhotos) {
        try {
          const photoResponse = await fetch("/api/service-orders/photos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: data._id, dataUrl: photo.dataUrl, filename: photo.filename }) });
          if (!photoResponse.ok) { const photoData = await photoResponse.json().catch(() => ({})); photoError = photoData.error || "No se pudo guardar una fotografía"; break; }
        } catch { photoError = "No se pudo guardar una fotografía"; break; }
      }
      setMessage(photoError ? `Orden ${data.orderNumber} creada, pero ${photoError.toLowerCase()}.` : `Orden ${data.orderNumber} creada correctamente con ${intakePhotos.length} ${intakePhotos.length === 1 ? "foto" : "fotos"} de ingreso.`);
      setCustomer(""); setPhone(""); setDevice(""); setImei(""); setIssue(""); setStatus("received"); setIntakePhotos([]); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error al crear la orden"); } finally { setSaving(false); } };
  return <main className="space-y-6 p-2 sm:p-4">
    <PageSectionHeader title="Servicio técnico" description="Órdenes de reparación, diagnóstico, equipos, repuestos y seguimiento." icon={Wrench} tone="amber" as="h1" />
    <div className="grid gap-4 md:grid-cols-4">{statCards.map(({ icon: Icon, label, key }) => <Card key={label}><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg border p-2"><Icon className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{key === "pendingBalance" ? `$${stats[key].toLocaleString("es-CO")}` : stats[key]}</p></div></CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle>Nueva orden de servicio</CardTitle><CardDescription>Recepción inicial del equipo y datos del cliente.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="customer">Cliente</Label><Input id="customer" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Nombre completo" /></div><div className="space-y-2"><Label htmlFor="phone">Teléfono</Label><Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="300 000 0000" /></div><div className="space-y-2"><Label htmlFor="device">Equipo</Label><Input id="device" value={device} onChange={e => setDevice(e.target.value)} placeholder="iPhone 15 Pro Max" /></div><div className="space-y-2"><Label htmlFor="imei">IMEI / serial</Label><Input id="imei" value={imei} onChange={e => setImei(e.target.value)} placeholder="IMEI o número de serie" /></div><div className="space-y-2 md:col-span-2"><Label htmlFor="issue">Falla reportada</Label><Textarea id="issue" value={issue} onChange={e => setIssue(e.target.value)} placeholder="Describe la falla indicada por el cliente" /></div>
      <div className="space-y-3 md:col-span-2 rounded-xl border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><Label className="flex items-center gap-2 text-base"><Camera className="h-4 w-4" />Fotos del ingreso</Label><p className="mt-1 text-sm text-muted-foreground">Toma fotos del estado físico antes de abrir o reparar el equipo. Máximo 12.</p></div><Button type="button" variant="outline" disabled={uploadingPhoto || intakePhotos.length >= 12} onClick={() => inputRef.current?.click()}>{uploadingPhoto ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}Agregar fotos</Button></div><input ref={inputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => void addIntakePhotos(Array.from(e.target.files || []))} />{intakePhotos.length > 0 ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{intakePhotos.map(photo => <div key={photo.id} className="group relative overflow-hidden rounded-xl border"><button type="button" className="block aspect-square w-full" onClick={() => setPreview(photo)}><img src={photo.dataUrl} alt={photo.filename || "Foto de ingreso"} className="h-full w-full object-cover" /></button><Button type="button" size="icon" variant="destructive" className="absolute right-2 top-2 h-8 w-8 opacity-0 transition group-hover:opacity-100" onClick={() => setIntakePhotos(current => current.filter(item => item.id !== photo.id))}><Trash2 className="h-4 w-4" /></Button><div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[11px] text-white">Ingreso</div></div>)}</div> : <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">Aún no hay fotos. Puedes tomarlas directamente con la cámara del iPhone o elegirlas de la galería.</div>}</div>
      <div className="space-y-2"><Label>Estado inicial</Label><Select value={status} onValueChange={value => setStatus(value as Status)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(statusLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div><div className="flex items-end gap-3"><div className="flex-1 rounded-lg border p-3 text-sm"><span className="text-muted-foreground">Validación:</span> {draftReady ? "datos básicos completos" : "faltan datos básicos"}</div><Button disabled={!draftReady || saving || uploadingPhoto} onClick={createOrder}>{saving ? "Guardando..." : "Crear orden"}</Button></div>
      {message && <div className="md:col-span-2 rounded-lg border p-3 text-sm">{message}</div>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Órdenes</CardTitle><CardDescription>Datos reales persistidos en MongoDB.</CardDescription></CardHeader><CardContent className="space-y-4"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por orden, cliente, teléfono, IMEI o serial" />{loading ? <div className="p-8 text-center text-sm text-muted-foreground">Cargando...</div> : orders.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No hay órdenes que coincidan.</div> : <div className="space-y-2">{orders.map(order => <Link key={order._id} href={`/admin/service-orders/${order._id}`} className="block rounded-lg border p-4 transition hover:bg-muted/50"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{order.orderNumber} · {order.customer}</p><p className="text-sm text-muted-foreground">{order.device} · {order.phone}{order.imei ? ` · ${order.imei}` : ""}</p></div><Badge>{statusLabels[order.status]}</Badge></div><p className="mt-2 text-sm">{order.issue}</p><p className="mt-2 text-sm font-medium">Saldo: ${Number(order.balance || 0).toLocaleString("es-CO")}</p></Link>)}</div>}</CardContent></Card>
    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}><button type="button" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" onClick={() => setPreview(null)} aria-label="Cerrar"><X className="h-5 w-5" /></button><img src={preview.dataUrl} alt={preview.filename || "Foto de ingreso"} className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain" onClick={event => event.stopPropagation()} /></div>}
  </main>;
}
