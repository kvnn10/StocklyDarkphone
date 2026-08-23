"use client";

import { useEffect, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";

type AuditItem = {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: unknown;
  ipAddress?: string | null;
  createdAt: string;
};

export default function AuditPage() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/admin/audit?q=${encodeURIComponent(q)}&limit=100`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("No se pudo cargar la auditoría");
        return res.json();
      })
      .then((data) => setItems(Array.isArray(data.items) ? data.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [q]);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-background shadow-sm"><ShieldCheck className="h-5 w-5" /></div>
          <div><h1 className="text-2xl font-bold tracking-tight">Actividad y auditoría</h1><p className="text-sm text-muted-foreground">Trazabilidad de las operaciones críticas de Stockly.</p></div>
        </div>
        <div className="relative w-full sm:w-80"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar acción, entidad o ID…" className="h-10 w-full rounded-xl border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" /></div>
      </div>

      <section className="overflow-hidden rounded-2xl border bg-background shadow-sm">
        <div className="border-b px-4 py-3 text-sm text-muted-foreground">{loading ? "Cargando actividad…" : `${items.length} registros mostrados`}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Acción</th><th className="px-4 py-3">Entidad</th><th className="px-4 py-3">ID</th><th className="px-4 py-3">Usuario</th><th className="px-4 py-3">Detalle</th></tr></thead>
            <tbody className="divide-y">
              {items.map((item) => <tr key={item.id} className="hover:bg-muted/20"><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{new Date(item.createdAt).toLocaleString("es-CO")}</td><td className="px-4 py-3 font-medium">{item.action}</td><td className="px-4 py-3">{item.entityType}</td><td className="px-4 py-3 font-mono text-xs">{item.entityId ?? "—"}</td><td className="px-4 py-3 font-mono text-xs">{item.userId}</td><td className="max-w-sm px-4 py-3 text-xs text-muted-foreground">{item.details ? JSON.stringify(item.details) : "—"}</td></tr>)}
              {!loading && items.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No hay registros de auditoría.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
