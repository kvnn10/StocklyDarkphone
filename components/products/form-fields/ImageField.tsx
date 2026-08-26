/**
 * Product Image Upload Field Component
 * Handles product image upload to ImageKit
 */

"use client";

import { useState, useRef } from "react";
import { SafeImage } from "@/components/ui/safe-image";
import { DialogFormLabel } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MdError } from "react-icons/md";
import { Image as ImageIcon, Upload, X, Loader2 } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";

export default function ImageField() {
  const { register, setValue, watch, formState: { errors } } = useFormContext();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const imageUrl = watch("imageUrl");
  const imageFileId = watch("imageFileId");
  const sku = watch("sku");

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast({ title: "Tipo de archivo no válido", description: "Solo se permiten imágenes JPEG, PNG y WebP.", variant: "destructive" });
      return;
    }
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({ title: "Archivo demasiado grande", description: "La imagen debe pesar menos de 5 MB.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (sku) formData.append("sku", sku);
      const response = await fetch("/api/products/image", { method: "POST", body: formData, credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "No se pudo subir la imagen");
      setValue("imageUrl", data.imageUrl, { shouldValidate: true });
      setValue("imageFileId", data.imageFileId, { shouldValidate: true });
      toast({ title: "Imagen subida", description: "La imagen del producto se subió correctamente." });
    } catch (error) {
      toast({ title: "Error al subir la imagen", description: error instanceof Error ? error.message : "No se pudo subir la imagen", variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveImage = async () => {
    if (imageFileId) {
      try {
        await fetch(`/api/products/image?fileId=${imageFileId}`, { method: "DELETE", credentials: "include" });
      } catch (error) {
        console.error("No se pudo eliminar la imagen de ImageKit:", error);
      }
    }
    setValue("imageUrl", "", { shouldValidate: true });
    setValue("imageFileId", "", { shouldValidate: true });
  };

  return (
    <div className="mt-5 flex h-full flex-col gap-2">
      <DialogFormLabel htmlFor="product-image" icon={ImageIcon} optional>Imagen del producto</DialogFormLabel>
      <Input {...register("imageUrl")} type="hidden" id="imageUrl" />
      <Input {...register("imageFileId")} type="hidden" id="imageFileId" />
      {imageUrl && (
        <div className="relative w-full">
          <SafeImage src={imageUrl} alt="Vista previa del producto" width={256} height={128} className="w-full h-32 object-cover rounded-lg border border-rose-400/30" unoptimized={imageUrl.includes("ik.imagekit.io")} />
          <Button type="button" variant="destructive" size="sm" onClick={handleRemoveImage} className="absolute top-2 right-2 h-8 w-8 p-0"><X className="h-4 w-4" /></Button>
        </div>
      )}
      {!imageUrl && (
        <div className="flex w-full flex-col gap-2">
          <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="h-11 w-full rounded-xl border border-rose-400/30 bg-gradient-to-r from-rose-500/30 via-rose-500/20 to-rose-500/15 text-gray-700 dark:text-white shadow-[0_10px_30px_rgba(225,29,72,0.2)] backdrop-blur-md transition duration-200 hover:border-rose-300/40 disabled:opacity-50 disabled:cursor-not-allowed">
            {isUploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Subiendo…</> : <><Upload className="h-4 w-4 mr-2" />Subir imagen</>}
          </Button>
          <Input ref={fileInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={handleImageSelect} className="hidden" id="product-image" />
        </div>
      )}
      {errors.imageUrl && <div className="text-red-500 flex gap-1 items-center text-[13px]"><MdError /><p>{String(errors.imageUrl.message)}</p></div>}
    </div>
  );
}
