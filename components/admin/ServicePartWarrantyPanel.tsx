"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Part = {
  id: string;
  productId: string;
  name: string;
  sku?: string;
  quantity: number;
  warrantyDays?: number;
  warrantyUntil?: string | null;
};

export default function ServicePartWarrantyPanel({ orderId }: { orderId: string }) {
  const [parts, setParts] = useState<Part[]>([]);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      const response = await fetch(
        `/api/service-orders/part-warranty?orderId=${encodeURIComponent(orderId)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar las garantías de repuestos");
      setParts(data.parts || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron cargar las garantías");
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [orderId]);

  const save = async (part: Part) => {
    setSavingId(part.id);
    setMessage("");
    try {
      const response = await fetch("/api/service-orders/part-warranty", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId,
          partId: part.id,
          warrantyDays: Number(part.warrantyDays || 0),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar");
      setParts(data.parts || []);
      setMessage("Garantía del repuesto actualizada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setSavingId("");
    }
  };

  return (
    <div className="px-2 pb-8 sm:px-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Garantía por repuesto
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada producto puede tener su propia garantía predeterminada. Al agregar un repuesto,
            Stockly toma esa regla como base y la guarda en la orden.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {parts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
              <Package className="mx-auto mb-2 h-5 w-5" />
              Agrega repuestos para configurar sus garantías.
            </div>
          ) : (
            parts.map((part) => (
              <div
                key={part.id}
                className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_140px_auto]"
              >
                <div>
                  <p className="font-medium">
                    {part.name} · {part.sku || "Sin SKU"}
                  </p>
                  <p className="text-xs text-muted-foreground">Cantidad: {part.quantity}</p>
                </div>
                <div>
                  <label className="text-xs font-medium">Garantía (días)</label>
                  <input
                    type="number"
                    min="0"
                    max="3650"
                    value={part.warrantyDays ?? 0}
                    onChange={(event) =>
                      setParts((current) =>
                        current.map((item) =>
                          item.id === part.id
                            ? { ...item, warrantyDays: Number(event.target.value || 0) }
                            : item,
                        ),
                      )
                    }
                    className="mt-1 flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={savingId === part.id}
                  onClick={() => void save(part)}
                  className="h-10 self-end rounded-md border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {savingId === part.id ? "Guardando..." : "Guardar"}
                </button>
              </div>
            ))
          )}
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
