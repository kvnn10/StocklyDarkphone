"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Search,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  UserX,
  X,
} from "lucide-react";
import Navbar from "@/components/layouts/Navbar";
import { PageContentWrapper, PageSectionHeader } from "@/components/shared";
import { StatisticsCard } from "@/components/home/StatisticsCard";

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

type ClientForm = {
  name: string;
  email: string;
  phone: string;
  whatsapp: string;
  document: string;
  address: string;
  city: string;
  notes: string;
};

const emptyForm: ClientForm = {
  name: "",
  email: "",
  phone: "",
  whatsapp: "",
  document: "",
  address: "",
  city: "",
  notes: "",
};

const formFields: Array<{
  key: keyof ClientForm;
  label: string;
  type?: string;
  icon: typeof UserRound;
  wide?: boolean;
}> = [
  { key: "name", label: "Nombre completo *", icon: UserRound },
  { key: "email", label: "Correo electrónico *", type: "email", icon: Mail },
  { key: "document", label: "Documento / NIT", icon: FileText },
  { key: "phone", label: "Teléfono", type: "tel", icon: Phone },
  { key: "whatsapp", label: "WhatsApp", type: "tel", icon: MessageCircle },
  { key: "city", label: "Ciudad", icon: MapPin },
  { key: "address", label: "Dirección", icon: MapPin, wide: true },
  { key: "notes", label: "Notas", icon: FileText, wide: true },
];

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "C";
}

function getAvatarTone(name: string) {
  const tones = [
    "from-rose-500/30 to-pink-500/10 text-rose-600 dark:text-rose-300",
    "from-violet-500/30 to-purple-500/10 text-violet-600 dark:text-violet-300",
    "from-sky-500/30 to-cyan-500/10 text-sky-600 dark:text-sky-300",
    "from-emerald-500/30 to-teal-500/10 text-emerald-600 dark:text-emerald-300",
    "from-amber-500/30 to-orange-500/10 text-amber-600 dark:text-amber-300",
  ];
  return tones[name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length];
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientForm>(emptyForm);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando clientes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadClients();
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return clients;
    return clients.filter((client) =>
      [client.name, client.email, client.phone, client.whatsapp, client.document, client.city]
        .some((value) => value?.toLowerCase().includes(q)),
    );
  }, [clients, query]);

  const activeCount = clients.filter((client) => client.status !== false).length;
  const inactiveCount = clients.length - activeCount;
  const whatsappCount = clients.filter((client) => Boolean(client.whatsapp)).length;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setTemporaryPassword("");
    setError("");
    setOpen(true);
  }

  function openEdit(client: Client) {
    setEditing(client);
    setForm({
      name: client.name,
      email: client.email,
      phone: client.phone || "",
      whatsapp: client.whatsapp || "",
      document: client.document || "",
      address: client.address || "",
      city: client.city || "",
      notes: client.notes || "",
    });
    setTemporaryPassword("");
    setError("");
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/clients", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { ...form, id: editing.id } : form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar el cliente");
      if (!editing && data.temporaryPassword) setTemporaryPassword(data.temporaryPassword);
      await loadClients();
      if (editing) setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function disable(client: Client) {
    if (!confirm(`¿Desactivar a ${client.name}?`)) return;
    const res = await fetch(`/api/clients?id=${client.id}`, { method: "DELETE" });
    if (res.ok) loadClients();
    else {
      const data = await res.json();
      setError(data.error || "No se pudo desactivar");
    }
  }

  return (
    <Navbar>
      <PageContentWrapper>
        <div className="flex flex-col poppins gap-6">
          <PageSectionHeader
            as="h2"
            icon={Users}
            tone="violet"
            title="Gestión de clientes"
            description="Administra clientes, información de contacto y acceso al portal desde un solo lugar."
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)]" />
              {loading ? "Actualizando clientes..." : `${filtered.length} de ${clients.length} clientes visibles`}
            </div>
            <button
              onClick={openCreate}
              className="group inline-flex items-center justify-center gap-2 rounded-xl border border-rose-400/40 bg-gradient-to-br from-rose-500/20 via-rose-500/10 to-violet-500/10 px-4 py-2.5 text-sm font-medium text-rose-700 shadow-[0_8px_25px_rgba(225,29,72,0.15)] backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-rose-400/60 hover:from-rose-500/30 hover:to-violet-500/20 dark:text-rose-200 dark:shadow-[0_8px_25px_rgba(225,29,72,0.2)]"
            >
              <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
              Nuevo cliente
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatisticsCard
              title="Total clientes"
              value={clients.length}
              description="Clientes registrados"
              icon={Users}
              variant="rose"
              valueLoading={loading}
              badges={[{ label: "Registrados", value: clients.length }]}
            />
            <StatisticsCard
              title="Clientes activos"
              value={activeCount}
              description="Con acceso habilitado"
              icon={UserCheck}
              variant="emerald"
              valueLoading={loading}
              badges={[{ label: "Activos", value: activeCount }]}
            />
            <StatisticsCard
              title="Clientes inactivos"
              value={inactiveCount}
              description="Sin acceso activo"
              icon={UserX}
              variant="violet"
              valueLoading={loading}
              badges={[{ label: "Inactivos", value: inactiveCount }]}
            />
            <StatisticsCard
              title="WhatsApp"
              value={whatsappCount}
              description="Con canal de contacto"
              icon={MessageCircle}
              variant="amber"
              valueLoading={loading}
              badges={[{ label: "Registrados", value: whatsappCount }]}
            />
          </div>

          <section className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/80 via-white/60 to-violet-500/[0.04] shadow-[0_15px_50px_rgba(2,132,199,0.08)] backdrop-blur-xl dark:from-white/[0.07] dark:via-white/[0.04] dark:to-violet-500/[0.08] dark:shadow-[0_15px_50px_rgba(15,23,42,0.25)]">
            <div className="border-b border-gray-200/70 p-4 dark:border-white/10 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-base font-medium text-gray-900 dark:text-white">Directorio de clientes</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Busca por nombre, correo, teléfono, documento o ciudad.</p>
                </div>
                <div className="relative w-full lg:max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar cliente..."
                    className="h-10 w-full rounded-xl border border-gray-200/70 bg-white/70 pl-9 pr-3 text-sm outline-none transition-all placeholder:text-muted-foreground focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/15 dark:border-white/10 dark:bg-white/[0.06]"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="mx-4 mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive sm:mx-5">
                {error}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200/70 bg-white/30 text-left text-muted-foreground dark:border-white/10 dark:bg-white/[0.02]">
                    <th className="px-5 py-3 font-medium">Cliente</th>
                    <th className="px-5 py-3 font-medium">Contacto</th>
                    <th className="px-5 py-3 font-medium">Documento</th>
                    <th className="px-5 py-3 font-medium">Ubicación</th>
                    <th className="px-5 py-3 font-medium">Estado</th>
                    <th className="px-5 py-3 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-14 text-center text-muted-foreground">
                        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500/20 border-t-violet-500" />
                        Cargando clientes...
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-14 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-500">
                          <UserPlus className="h-6 w-6" />
                        </div>
                        <p className="font-medium">No hay clientes que coincidan</p>
                        <p className="mt-1 text-sm text-muted-foreground">Prueba otra búsqueda o crea un nuevo cliente.</p>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((client) => (
                      <tr
                        key={client.id}
                        className="group border-b border-gray-200/60 transition-colors last:border-0 hover:bg-violet-500/[0.035] dark:border-white/[0.07] dark:hover:bg-white/[0.035]"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-gradient-to-br font-semibold shadow-sm ${getAvatarTone(client.name)}`}>
                              {getInitials(client.name)}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-gray-900 dark:text-white">{client.name}</div>
                              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                <Mail className="h-3 w-3" />
                                <span className="truncate">{client.email}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-col gap-1.5">
                            {client.phone && (
                              <span className="inline-flex items-center gap-1.5 text-gray-700 dark:text-gray-200">
                                <Phone className="h-3.5 w-3.5 text-sky-500" />
                                {client.phone}
                              </span>
                            )}
                            {client.whatsapp && (
                              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />
                                {client.whatsapp}
                              </span>
                            )}
                            {!client.phone && !client.whatsapp && <span className="text-muted-foreground">—</span>}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">{client.document || "—"}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5 text-violet-500" />
                            {client.city || "Sin ciudad"}
                          </div>
                          {client.address && <div className="mt-1 max-w-[190px] truncate text-xs text-muted-foreground">{client.address}</div>}
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${client.status === false ? "border-gray-300/50 bg-gray-500/10 text-gray-500 dark:border-white/10" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${client.status === false ? "bg-gray-400" : "bg-emerald-500 shadow-[0_0_7px_rgba(16,185,129,0.6)]"}`} />
                            {client.status === false ? "Inactivo" : "Activo"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex justify-end gap-2 opacity-80 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={() => openEdit(client)}
                              className="rounded-lg border border-gray-200/80 bg-white/50 px-3 py-1.5 text-xs font-medium transition-all hover:border-violet-400/40 hover:bg-violet-500/10 dark:border-white/10 dark:bg-white/[0.04]"
                            >
                              Editar
                            </button>
                            {client.status !== false && (
                              <button
                                onClick={() => disable(client)}
                                className="rounded-lg px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                              >
                                Desactivar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </PageContentWrapper>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/95 via-white/90 to-violet-500/[0.07] shadow-[0_25px_80px_rgba(15,23,42,0.35)] dark:from-[#17181d]/95 dark:via-[#17181d]/95 dark:to-violet-500/[0.08]">
            <div className="flex items-center justify-between border-b border-gray-200/70 px-5 py-4 dark:border-white/10 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-400/30 bg-gradient-to-br from-violet-500/25 via-violet-500/10 to-rose-500/10 text-violet-600 shadow-[0_8px_25px_rgba(139,92,246,0.2)] dark:text-violet-300">
                  {editing ? <UserRound className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="text-lg font-medium text-gray-900 dark:text-white">{editing ? "Editar cliente" : "Nuevo cliente"}</h2>
                  <p className="text-xs text-muted-foreground">Información para pedidos, facturas y contacto.</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto px-5 py-5 sm:px-6">
              <div className="grid gap-4 sm:grid-cols-2">
                {formFields.map(({ key, label, type = "text", icon: Icon, wide }) => (
                  <label key={key} className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
                    <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
                      <Icon className="h-3.5 w-3.5 text-violet-500" />
                      {label}
                    </span>
                    {key === "notes" ? (
                      <textarea
                        value={form[key]}
                        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                        rows={3}
                        className="w-full resize-none rounded-xl border border-gray-200/80 bg-white/60 px-3 py-2.5 text-sm outline-none transition-all placeholder:text-muted-foreground focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/15 dark:border-white/10 dark:bg-white/[0.05]"
                      />
                    ) : (
                      <input
                        type={type}
                        value={form[key]}
                        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                        className="h-10 w-full rounded-xl border border-gray-200/80 bg-white/60 px-3 text-sm outline-none transition-all placeholder:text-muted-foreground focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/15 dark:border-white/10 dark:bg-white/[0.05]"
                      />
                    )}
                  </label>
                ))}
              </div>

              {temporaryPassword && (
                <div className="mt-5 rounded-xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 p-4 text-sm text-emerald-800 dark:text-emerald-200">
                  <div className="font-medium">Cliente creado correctamente</div>
                  <div className="mt-1 text-xs opacity-80">Contraseña temporal para el portal:</div>
                  <code className="mt-2 inline-flex rounded-lg border border-emerald-400/20 bg-background/70 px-3 py-1.5 font-mono text-xs">{temporaryPassword}</code>
                </div>
              )}

              {error && <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200/70 bg-white/30 px-5 py-4 dark:border-white/10 dark:bg-white/[0.02] sm:px-6">
              <button onClick={() => setOpen(false)} className="rounded-xl border border-gray-200/80 bg-white/60 px-4 py-2 text-sm transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/10">
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl border border-violet-400/30 bg-gradient-to-br from-violet-500/25 via-violet-500/15 to-rose-500/10 px-4 py-2 text-sm font-medium text-violet-700 shadow-[0_8px_25px_rgba(139,92,246,0.15)] transition-all hover:-translate-y-0.5 hover:from-violet-500/35 disabled:cursor-not-allowed disabled:opacity-60 dark:text-violet-200"
              >
                {saving ? "Guardando..." : editing ? "Guardar cambios" : "Crear cliente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Navbar>
  );
}
