"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, Trash2, X, Wrench, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Stage = "ingreso" | "reparacion" | "entrega";
type Photo = { id: string; url: string; filename?: string; category?: Stage; stage?: Stage; uploadedAt?: string };
type Order = { _id: string; status: string; photos?: Photo[] };

const stages: { key: Stage; label: string; description: string; icon: typeof Camera }[] = [
  { key: "ingreso", label: "Ingreso", description: "Cómo llegó el equipo antes de abrirlo.", icon: Camera },
  { key: "reparacion", label: "Durante reparación", description: "Proceso, componentes y hallazgos.", icon: Wrench },
  { key: "entrega", label: "Entrega", description: "Estado final antes de devolverlo.", icon: CheckCircle2 },
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

export default function ServiceOrderPhotoEvidence({ orderId }: { orderId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [stage, setStage] = useState<Stage>("ingreso");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Photo | null>(null);

  const load = async () => {
    try {
      const response = await fetch(`/api/service-orders?search=${encodeURIComponent(orderId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar la evidencia");
      const found = data.orders?.find((item: Order) => item._id === orderId);
      setOrder(found || null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo cargar la evidencia"); }
  };

  useEffect(() => { void load(); }, [orderId]);

  const upload = async (file: File) => {
    setUploading(true); setMessage("");
    try {
      if (!file.type.startsWith("image/")) throw new Error("Selecciona una imagen");
      const dataUrl = await compressImage(file);
      const response = await fetch("/api/service-orders/photos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, dataUrl, filename: file.name, stage }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la fotografía");
      setOrder(current => current ? { ...current, photos: [...(current.photos || []), data.photo] } : current);
      setMessage("Evidencia agregada correctamente.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar la fotografía"); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const remove = async (photoId: string) => {
    if (!confirm("¿Eliminar esta fotografía de la evidencia?")) return;
    setMessage("");
    try {
      const response = await fetch("/api/service-orders/photos", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, photoId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar");
      setOrder(current => current ? { ...current, photos: (current.photos || []).filter(photo => photo.id !== photoId) } : current);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo eliminar"); }
  };

  const photos = order?.photos || [];
  const stagePhotos = photos.filter(photo => (photo.stage || photo.category || "ingreso") === stage);
  const closed = order ? ["delivered", "cancelled"].includes(order.status) : false;
  const currentStage = stages.find(item => item.key === stage)!;
  const StageIcon = currentStage.icon;

  return <>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><Camera className="h-5 w-5" />Evidencia fotográfica</span>
          <span className="text-xs font-normal text-muted-foreground">{photos.length}/12 fotos</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-3">
          {stages.map(item => {
            const Icon = item.icon;
            const count = photos.filter(photo => (photo.stage || photo.category || "ingreso") === item.key).length;
            return <button key={item.key} type="button" onClick={() => setStage(item.key)} className={`rounded-xl border p-3 text-left transition ${stage === item.key ? "border-foreground bg-muted" : "hover:bg-muted/50"}`}>
              <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 font-medium"><Icon className="h-4 w-4" />{item.label}</span><span className="text-xs text-muted-foreground">{count}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
            </button>;
          })}
        </div>

        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="flex items-center gap-2 font-medium text-foreground"><StageIcon className="h-4 w-4" />{currentStage.label}</p><p>{currentStage.description}</p></div>
            <Button type="button" disabled={uploading || closed || photos.length >= 12} onClick={() => inputRef.current?.click()}>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}Cargar fotos
            </Button>
          </div>
          <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={async event => { for (const file of Array.from(event.target.files || [])) { if ((order?.photos?.length || 0) >= 12) break; await upload(file); } }} />
        </div>

        {stagePhotos.length > 0 ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {stagePhotos.map(photo => <div key={photo.id} className="group relative overflow-hidden rounded-xl border bg-muted/20">
            <button type="button" className="block aspect-square w-full" onClick={() => setPreview(photo)} aria-label="Ver fotografía"><img src={photo.url} alt={photo.filename || `Evidencia de ${currentStage.label.toLowerCase()}`} className="h-full w-full object-cover transition group-hover:scale-[1.02]" /></button>
            {!closed && <Button type="button" size="icon" variant="destructive" className="absolute right-2 top-2 h-8 w-8 opacity-0 transition group-hover:opacity-100" onClick={() => void remove(photo.id)}><Trash2 className="h-4 w-4" /></Button>}
            <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[11px] text-white">{currentStage.label}</div>
          </div>)}
        </div> : <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No hay fotografías en esta etapa todavía.</div>}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>

    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
      <button type="button" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white" onClick={() => setPreview(null)} aria-label="Cerrar"><X className="h-5 w-5" /></button>
      <img src={preview.url} alt={preview.filename || "Evidencia"} className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain" onClick={event => event.stopPropagation()} />
    </div>}
  </>;
}
