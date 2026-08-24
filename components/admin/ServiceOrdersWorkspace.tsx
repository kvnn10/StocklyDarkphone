"use client";

import { useMemo, useState } from "react";
import { Wrench, Smartphone, UserRound, ClipboardList, CircleDollarSign } from "lucide-react";
import { PageSectionHeader } from "@/components/shared/PageSectionHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const statusLabels = {
  received: "Recibido",
  diagnosis: "Diagnóstico",
  awaiting_approval: "Esperando aprobación",
  repairing: "En reparación",
  ready: "Listo",
  delivered: "Entregado",
  cancelled: "Cancelado",
} as const;

export default function ServiceOrdersWorkspace() {
  const [status, setStatus] = useState<keyof typeof statusLabels>("received");
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [device, setDevice] = useState("");
  const [imei, setImei] = useState("");
  const [issue, setIssue] = useState("");

  const draftReady = useMemo(
    () => customer.trim() && phone.trim() && device.trim() && issue.trim(),
    [customer, phone, device, issue],
  );

  return (
    <main className="space-y-6 p-2 sm:p-4">
      <PageSectionHeader
        title="Servicio técnico"
        description="Órdenes de reparación, diagnóstico, equipos, repuestos y seguimiento."
        icon={Wrench}
        tone="amber"
        as="h1"
      />

      <div className="grid gap-4 md:grid-cols-4">
        {[
          [ClipboardList, "Órdenes abiertas", "0"],
          [Smartphone, "En reparación", "0"],
          [UserRound, "Pendientes de aprobación", "0"],
          [CircleDollarSign, "Saldo pendiente", "$0"],
        ].map(([Icon, label, value]) => (
          <Card key={String(label)}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg border p-2"><Icon className="h-5 w-5" /></div>
              <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nueva orden de servicio</CardTitle>
          <CardDescription>Recepción inicial del equipo y datos del cliente.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="customer">Cliente</Label><Input id="customer" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Nombre completo" /></div>
          <div className="space-y-2"><Label htmlFor="phone">Teléfono</Label><Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="300 000 0000" /></div>
          <div className="space-y-2"><Label htmlFor="device">Equipo</Label><Input id="device" value={device} onChange={(e) => setDevice(e.target.value)} placeholder="iPhone 15 Pro Max" /></div>
          <div className="space-y-2"><Label htmlFor="imei">IMEI / serial</Label><Input id="imei" value={imei} onChange={(e) => setImei(e.target.value)} placeholder="IMEI o número de serie" /></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="issue">Falla reportada</Label><Textarea id="issue" value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="Describe la falla indicada por el cliente" /></div>
          <div className="space-y-2"><Label>Estado inicial</Label><Select value={status} onValueChange={(value) => setStatus(value as keyof typeof statusLabels)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(statusLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-end"><div className="w-full rounded-lg border p-3 text-sm"><span className="text-muted-foreground">Validación:</span> {draftReady ? "datos básicos completos" : "faltan datos básicos"}</div></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Órdenes</CardTitle><CardDescription>La búsqueda y persistencia quedarán conectadas a la capa MongoDB del módulo.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por orden, cliente, teléfono, IMEI o serial" />
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {search ? `Sin órdenes persistidas que coincidan con “${search}”.` : "No hay órdenes de servicio cargadas todavía."}
          </div>
          <div className="flex flex-wrap gap-2">{Object.entries(statusLabels).map(([key, label]) => <Badge key={key} variant={key === status ? "default" : "outline"}>{label}</Badge>)}</div>
        </CardContent>
      </Card>
    </main>
  );
}
