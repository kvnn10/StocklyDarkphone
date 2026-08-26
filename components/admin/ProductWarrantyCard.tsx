"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ProductWarrantyCard({ productId }: { productId: string }) {
  const [days, setDays] = useState("0");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/products/warranty?productId=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo cargar la garantía");
        if (!active) return;
        setName(data.name || "");
        setDays(String(data.warrantyDays ?? 0));
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "No se pudo cargar la garantía");
      });
    return () => { active = false; };
  }, [productId]);

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/products/warranty", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, warrantyDays: Number(days || 0) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la garantía");
      setDays(String(data.warrantyDays ?? 0));
      setMessage("Garantía predeterminada guardada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la garantía");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Garantía predeterminada
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {name
            ? `Cuando ${name} se utilice como repuesto, esta será la garantía sugerida automáticamente.`
            : "Define la garantía que tendrá este producto cuando se utilice como repuesto."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-sm font-medium">Días de garantía</label>
            <input
              type="number"
              min="0"
              max="3650"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className="mt-1 flex h-10 w-40 rounded-md border bg-background px-3 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar garantía"}
          </button>
          <span className="text-xs text-muted-foreground">
            {Number(days || 0) === 0 ? "Sin garantía predeterminada" : `${days} días`}
          </span>
        </div>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
