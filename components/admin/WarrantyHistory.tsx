"use client";

import { useEffect, useState } from "react";
import { History, ShieldCheck, Smartphone, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type HistoryOrder = {
  _id: string;
  orderNumber: string;
  device: string;
  issue: string;
  status: string;
  total: number;
  createdAt: string;
  warrantyUntil?: string | null;
  warrantyDays?: number;
  warrantyNote?: string;
  imei?: string;
  serial?: string;
};

const statusLabel: Record<string, string> = {
  received: "Recibido",
  diagnosis: "Diagnóstico",
  awaiting_approval: "Esperando aprobación",
  repairing: "En reparación",
  ready: "Listo",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

const money = (value: number) => `$${Number(value || 0).toLocaleString("es-CO")}`;

export default function WarrantyHistory({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<HistoryOrder | null>(null);
  const [history, setHistory] = useState<HistoryOrder[]>([]);
  const [days, setDays] = useState("90");
  const [note, setNote] = useState("Garantía sobre la reparación realizada.");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      const response = await fetch(
        `/api/service-orders/warranty?orderId=${encodeURIComponent(orderId)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar la garantía");
      setOrder(data.order);
      setHistory(data.history || []);
      setDays(String(data.order?.warrantyDays ?? 90));
      setNote(data.order?.warrantyNote || "Garantía sobre la reparación realizada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar la garantía");
    }
  };

  useEffect(() => {
    void load();
  }, [orderId]);

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/service-orders/warranty", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, warrantyDays: Number(days || 0), warrantyNote: note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la garantía");
      setMessage("Garantía guardada correctamente.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la garantía");
    } finally {
      setSaving(false);
    }
  };

  const warrantyDate = order?.warrantyUntil ? new Date(order.warrantyUntil) : null;
  const active = warrantyDate ? warrantyDate >= new Date() : false;

  return (
    <div className="space-y-6 px-2 pb-8 sm:px-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Garantía general de la reparación
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="text-sm font-medium">Días de garantía</label>
              <input
                type="number"
                min="0"
                max="3650"
                value={days}
                onChange={(event) => setDays(event.target.value)}
                className="mt-2 flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium">Condiciones / nota</label>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                className="mt-2 flex min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={saving || order?.status !== "delivered"}
              onClick={() => void save()}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              {saving ? "Guardando..." : "Activar / actualizar garantía"}
            </button>
            {warrantyDate ? (
              <span className="rounded-full border px-3 py-1 text-sm">
                {active ? "Garantía vigente" : "Garantía vencida"} · vence {warrantyDate.toLocaleDateString("es-CO")}
              </span>
            ) : null}
            {order?.status !== "delivered" ? (
              <span className="text-xs text-muted-foreground">Se activa al entregar la reparación.</span>
            ) : null}
          </div>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historial del equipo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {order ? (
            <div className="rounded-lg border p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <Smartphone className="h-4 w-4" />
                {order.device}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">IMEI: {order.imei || "—"} · Serial: {order.serial || "—"}</p>
            </div>
          ) : null}
          {history.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">No hay reparaciones anteriores asociadas a este IMEI o serial.</p>
          ) : (
            history.map((item) => (
              <div key={item._id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{item.orderNumber} · {item.device}</p>
                    <p className="text-xs text-muted-foreground">
                      <CalendarDays className="mr-1 inline h-3 w-3" />
                      {new Date(item.createdAt).toLocaleDateString("es-CO")} · {statusLabel[item.status] || item.status}
                    </p>
                  </div>
                  <span className="font-semibold">{money(item.total)}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.issue}</p>
                {item.warrantyUntil ? (
                  <p className="mt-2 text-xs">
                    Garantía: {new Date(item.warrantyUntil) >= new Date() ? "vigente hasta" : "vencida el"} {new Date(item.warrantyUntil).toLocaleDateString("es-CO")}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
