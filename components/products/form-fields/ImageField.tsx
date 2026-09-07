/**
 * Product Media Upload Field Component
 * Handles product image or video upload to Vercel Blob.
 */
"use client";

import { useRef, useState } from "react";
import { SafeImage } from "@/components/ui/safe-image";
import { DialogFormLabel } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MdError } from "react-icons/md";
import { Image as ImageIcon, Upload, X, Loader2, Video } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";

const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export default function ImageField() {
  const { register, setValue, watch, formState: { errors } } = useFormContext();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const mediaUrl = watch("imageUrl");
  const mediaFileId = watch("imageFileId");
  const sku = watch("sku");
  const isVideo = typeof mediaUrl === "string" && /\.(mp4|webm|mov)(?:\?|$)/i.test(mediaUrl);

  const handleMediaSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowed = [...IMAGE_TYPES, ...VIDEO_TYPES];
    if (!allowed.includes(file.type)) {
      toast({ title: "Tipo de archivo no válido", description: "Usa una imagen JPEG, PNG, WebP o un video MP4, WebM o MOV.", variant: "destructive" });
      return;
    }
    const maxSize = 4 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({ title: "Archivo demasiado grande", description: "La imagen o video debe pesar menos de 4 MB.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (sku) formData.append("sku", sku);
      const response = await fetch("/api/products/image", { method: "POST", body: formData, credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "No se pudo subir el archivo");
      setValue("imageUrl", data.imageUrl, { shouldValidate: true });
      setValue("imageFileId", data.imageFileId, { shouldValidate: true });
      toast({ title: file.type.startsWith("video/") ? "Video subido" : "Imagen subida", description: "El archivo multimedia se subió correctamente." });
    } catch (error) {
      toast({ title: "Error al subir multimedia", description: error instanceof Error ? error.message : "No se pudo subir el archivo", variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveMedia = async () => {
    if (mediaFileId) {
      try { await fetch(`/api/products/image?fileId=${encodeURIComponent(mediaFileId)}`, { method: "DELETE", credentials: "include" }); }
      catch (error) { console.error("No se pudo eliminar el archivo multimedia:", error); }
    }
    setValue("imageUrl", "", { shouldValidate: true });
    setValue("imageFileId", "", { shouldValidate: true });
  };

  return (
    <div className="mt-5 flex h-full flex-col gap-2">
      <DialogFormLabel htmlFor="product-image" icon={ImageIcon} optional>Imagen o video del producto</DialogFormLabel>
      <Input {...register("imageUrl")} type="hidden" id="imageUrl" />
      <Input {...register("imageFileId")} type="hidden" id="imageFileId" />
      {mediaUrl && (
        <div className="relative w-full overflow-hidden rounded-lg border border-rose-400/30 bg-black/20">
          {isVideo ? (
            <video src={mediaUrl} controls playsInline className="h-32 w-full object-contain" />
          ) : (
            <SafeImage src={mediaUrl} alt="Vista previa del producto" width={256} height={128} className="h-32 w-full object-cover" unoptimized={mediaUrl.includes("ik.imagekit.io")} />
          )}
          <Button type="button" variant="destructive" size="sm" onClick={handleRemoveMedia} className="absolute right-2 top-2 h-8 w-8 p-0"><X className="h-4 w-4" /></Button>
        </div>
      )}
      {!mediaUrl && (
        <div className="flex w-full flex-col gap-2">
          <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="h-11 w-full rounded-xl border border-rose-400/30 bg-gradient-to-r from-rose-500/30 via-rose-500/20 to-rose-500/15 text-gray-700 dark:text-white shadow-[0_10px_30px_rgba(225,29,72,0.2)] backdrop-blur-md transition duration-200 hover:border-rose-300/40 disabled:opacity-50 disabled:cursor-not-allowed">
            {isUploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Subiendo…</> : <><Upload className="mr-2 h-4 w-4" />Subir imagen o video</>}
          </Button>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Video className="h-3 w-3" />Imágenes hasta 4 MB · videos MP4/WebM/MOV hasta 4 MB</p>
          <Input ref={fileInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={handleMediaSelect} className="hidden" id="product-image" />
        </div>
      )}
      {errors.imageUrl && <div className="flex items-center gap-1 text-[13px] text-red-500"><MdError /><p>{String(errors.imageUrl.message)}</p></div>}
    </div>
  );
}
