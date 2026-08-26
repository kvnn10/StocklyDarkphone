"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Smartphone, History, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Order = { _id: string; orderNumber: string; customer: string; device: string; imei?: string; serial?: string; status: string; total?: number; createdAt?: string };
type Device = { _id: string; clientId?: string; clientName?: string; name?: string; brand?: string; model?: string; imei?: string; serial?: string; color?: string; storage?: string; status?: string };

const statusLabels: Record<string, string> = { received: "Recibido", diagnosis: "Diagnóstico", awaiting_approval: "Esperando aprobación", repairing: "En reparación", ready: "Listo", delivered: "Entregado", cancelled: "Cancelado" };

export default function ServiceOrderDeviceHistory({ orderId }: { orderId: string }) {
  const [device, setDevice] = useState<Device | null>(null);
  const [history, setHistory] = useState<Order[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch(`/api/service-orders?search=${encodeURIComponent(orderId)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo cargar el historial");
        const current = (data.orders || []).find((item: Order) => item._id === orderId || item.orderNumber === orderId) as Order | undefined;
        if (!current || (!current.imei && !current.serial)) return;
        const identifier = current.imei || current.serial || "";
        const deviceResponse = await fetch(`/api/devices?search=${encodeURIComponent(identifier)}`, { cache: "no-store" });
        const deviceData = await deviceResponse.json();
        const linked = (deviceData.devices || []).find((item: Device) => (current.imei && item.imei === current.imei) || (current.serial && item.serial === current.serial)) as Device | undefined;
        const historyResponse = await fetch(`/api/service-orders?search=${encodeURIComponent(identifier)}`, { cache: "no-store" });
        const historyData = await historyResponse.json();
        if (!active) return;
        setDevice(linked || null);
        setHistory((historyData.orders || []).filter((item: Order) => item._id !== current._id));
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "No se pudo cargar el historial del equipo");
      }
    })();
    return () => { active = false; };
  }, [orderId]);

  if (!device && !history.length && !message) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" />Equipo e historial del cliente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {device ? (
          <div className="rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{device.name || `${device.brand || ""} ${device.model || ""}`.trim() || "Equipo registrado"}</p>
                <p className="text-sm text-muted-foreground">Cliente: {device.clientName || "—"}</p>
              </div>
              <Badge>{device.status === "active" ? "Activo" : device.status || "Registrado"}</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <span><b>IMEI:</b> {device.imei || "—"}</span>
              <span><b>Serial:</b> {device.serial || "—"}</span>
              <span><b>Color:</b> {device.color || "—"}</span>
              <span><b>Capacidad:</b> {device.storage || "—"}</span>
            </div>
            <Link href="/admin/devices" className="mt-3 inline-flex items-center text-sm font-medium underline underline-offset-4">Abrir Equipos / IMEI <ExternalLink className="ml-1 h-3.5 w-3.5" /></Link>
          </div>
        ) : null}

        {history.length > 0 ? (
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-medium"><History className="h-4 w-4" />Reparaciones anteriores de este equipo</p>
            <div className="space-y-2">
              {history.slice(0, 10).map(item => (
                <Link key={item._id} href={`/admin/service-orders/${item._id}`} className="block rounded-lg border p-3 hover:bg-muted/50">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{item.orderNumber} · {item.device}</span><Badge>{statusLabels[item.status] || item.status}</Badge></div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.customer}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString("es-CO")}` : ""}</p>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
