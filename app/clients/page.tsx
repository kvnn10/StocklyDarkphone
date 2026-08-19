"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Users, Phone, Mail, MapPin, MoreHorizontal, UserRound, X } from "lucide-react";

interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  whatsapp?: string;
  document?: string;
  address?: string;
  city?: string;
  notes?: string;
  status?: boolean;
  createdAt?: string;
}

const emptyForm = { name: "", email: "", phone: "", whatsapp: "", document: "", address: "", city: "", notes: "" };

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");

  async function loadClients() {
    setLoading(true);
    try {
      const res = await fetch("/api/clients", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar los clientes");
      setClients(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Error cargando clientes"); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadClients(); }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return clients;
    return clients.filter(c => [c.name, c.email, c.phone, c.document, c.city].some(v => v?.toLowerCase().includes(q)));
  }, [clients, query]);

  function openCreate() { setEditing(null); setForm(emptyForm); setTemporaryPassword(""); setError(""); setOpen(true); }
  function openEdit(client: Client) { setEditing(client); setForm({ name: client.name, email: client.email, phone: client.phone || "", whatsapp: client.whatsapp || "", document: client.document || "", address: client.address || "", city: client.city || "", notes: client.notes || "" }); setTemporaryPassword(""); setError(""); setOpen(true); }

  async function save() {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/clients", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { ...form, id: editing.id } : form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar el cliente");
      if (!editing && data.temporaryPassword) setTemporaryPassword(data.temporaryPassword);
      await loadClients();
      if (editing) setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar"); }
    finally { setSaving(false); }
  }

  async function disable(client: Client) {
    if (!confirm(`¿Desactivar a ${client.name}?`)) return;
    const res = await fetch(`/api/clients?id=${client.id}`, { method: "DELETE" });
    if (res.ok) loadClients();
    else { const data = await res.json(); setError(data.error || "No se pudo desactivar"); }
  }

  return (
    <main className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">Clientes</h1><p className="text-sm text-muted-foreground mt-1">Administra tus clientes y su información de contacto.</p></div>
        <button onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"><Plus className="h-4 w-4" />Nuevo cliente</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-5"><div className="flex items-center gap-3"><div className="rounded-lg bg-primary/10 p-2"><Users className="h-5 w-5 text-primary" /></div><div><p className="text-sm text-muted-foreground">Total de clientes</p><p className="text-2xl font-semibold">{clients.length}</p></div></div></div>
        <div className="rounded-xl border bg-card p-5"><div className="flex items-center gap-3"><div className="rounded-lg bg-green-500/10 p-2"><UserRound className="h-5 w-5 text-green-600" /></div><div><p className="text-sm text-muted-foreground">Clientes activos</p><p className="text-2xl font-semibold">{clients.filter(c => c.status !== false).length}</p></div></div></div>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="border-b p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar cliente, correo, teléfono o documento..." className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" /></div></div>
        {error && <div className="mx-4 mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="px-5 py-3 font-medium">Cliente</th><th className="px-5 py-3 font-medium">Contacto</th><th className="px-5 py-3 font-medium">Documento</th><th className="px-5 py-3 font-medium">Ciudad</th><th className="px-5 py-3 font-medium">Estado</th><th className="px-5 py-3"></th></tr></thead>
            <tbody>{loading ? <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">Cargando clientes...</td></tr> : filtered.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">No hay clientes que coincidan con la búsqueda.</td></tr> : filtered.map(client => <tr key={client.id} className="border-b last:border-0 hover:bg-muted/30"><td className="px-5 py-4"><div className="font-medium">{client.name}</div><div className="text-xs text-muted-foreground">{client.email}</div></td><td className="px-5 py-4"><div className="flex flex-col gap-1">{client.phone && <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{client.phone}</span>}{client.whatsapp && client.whatsapp !== client.phone && <span className="text-xs text-muted-foreground">WhatsApp: {client.whatsapp}</span>}</div></td><td className="px-5 py-4">{client.document || "—"}</td><td className="px-5 py-4">{client.city || "—"}</td><td className="px-5 py-4"><span className={`rounded-full px-2 py-1 text-xs ${client.status === false ? "bg-muted text-muted-foreground" : "bg-green-500/10 text-green-700 dark:text-green-400"}`}>{client.status === false ? "Inactivo" : "Activo"}</span></td><td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><button onClick={() => openEdit(client)} className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted">Editar</button>{client.status !== false && <button onClick={() => disable(client)} className="rounded-md px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">Desactivar</button>}</div></td></tr>)}</tbody>
          </table>
        </div>
      </div>

      {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-2xl rounded-2xl border bg-background shadow-xl"><div className="flex items-center justify-between border-b p-5"><div><h2 className="text-lg font-semibold">{editing ? "Editar cliente" : "Nuevo cliente"}</h2><p className="text-sm text-muted-foreground">Información para pedidos, facturas y contacto.</p></div><button onClick={() => setOpen(false)} className="rounded-md p-2 hover:bg-muted"><X className="h-4 w-4" /></button></div><div className="grid gap-4 p-5 sm:grid-cols-2">
        {[["name","Nombre completo *"],["email","Correo electrónico *"],["document","Documento / NIT"],["phone","Teléfono"],["whatsapp","WhatsApp"],["city","Ciudad"],["address","Dirección"],["notes","Notas"]].map(([key,label]) => <label key={key} className="space-y-1.5"><span className="text-sm font-medium">{label}</span><input value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" /></label>)}
      </div>{temporaryPassword && <div className="mx-5 mb-5 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"><strong>Cliente creado.</strong> Contraseña temporal para el portal: <code className="ml-1 rounded bg-background px-2 py-1">{temporaryPassword}</code></div>}{error && <div className="mx-5 mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}<div className="flex justify-end gap-2 border-t p-5"><button onClick={() => setOpen(false)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button onClick={save} disabled={saving} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear cliente"}</button></div></div></div>}
    </main>
  );
}
