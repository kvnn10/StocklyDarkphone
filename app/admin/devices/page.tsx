"use client";

import { useEffect, useMemo, useState } from "react";
import { Smartphone, Search, Plus, ShieldCheck } from "lucide-react";

type Client = { _id: string; name: string; email?: string };
type Device = { _id: string; clientId: string; clientName: string; name: string; brand?: string; model?: string; imei?: string; serial?: string; phonePasscode?: string; color?: string; storage?: string; notes?: string; status?: string };

export default function AdminDevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ clientId: "", brand: "", model: "", imei: "", serial: "", phonePasscode: "", color: "", storage: "", notes: "" });

  async function load() {
    const res = await fetch(`/api/devices?search=${encodeURIComponent(search)}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No se pudieron cargar los equipos");
    setDevices(data.devices || []); setClients(data.clients || []);
  }
  useEffect(() => { load().catch(e => setMessage(e instanceof Error ? e.message : "Error cargando equipos")); }, [search]);

  const selectedClient = useMemo(() => clients.find(c => c._id === form.clientId), [clients, form.clientId]);

  async function createDevice() {
    if (!form.clientId || (!form.imei.trim() && !form.serial.trim()) || (!form.brand.trim() && !form.model.trim())) {
      setMessage("Selecciona el cliente, indica el equipo y registra IMEI o serial."); return;
    }
    setLoading(true); setMessage("");
    try {
      const res = await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "No se pudo registrar el equipo");
      setMessage("Equipo registrado correctamente."); setForm({ clientId: "", brand: "", model: "", imei: "", serial: "", phonePasscode: "", color: "", storage: "", notes: "" }); setShowForm(false); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Error registrando equipo"); }
    finally { setLoading(false); }
  }

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div><h1 className="text-2xl font-semibold flex items-center gap-2"><Smartphone className="h-6 w-6" />Equipos de clientes</h1><p className="text-sm text-muted-foreground">Registra dispositivos por cliente y usa IMEI/serial como identidad técnica.</p></div>
      <button onClick={() => setShowForm(v => !v)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />Nuevo equipo</button>
    </div>
    {message && <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">{message}</div>}
    {showForm && <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5 space-y-4">
      <h2 className="font-semibold">Registrar equipo</h2>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <select className="rounded-lg border bg-background p-2" value={form.clientId} onChange={e => setForm({ ...form, clientId: e.target.value })}><option value="">Cliente</option>{clients.map(c => <option key={c._id} value={c._id}>{c.name}{c.email ? ` · ${c.email}` : ""}</option>)}</select>
        <input className="rounded-lg border bg-background p-2" placeholder="Marca" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} />
        <input className="rounded-lg border bg-background p-2" placeholder="Modelo" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} />
        <input className="rounded-lg border bg-background p-2" placeholder="IMEI" value={form.imei} onChange={e => setForm({ ...form, imei: e.target.value })} />
        <input className="rounded-lg border bg-background p-2" placeholder="Serial" value={form.serial} onChange={e => setForm({ ...form, serial: e.target.value })} />
        <input className="rounded-lg border bg-background p-2" type="number" inputMode="numeric" min="0" step="1" placeholder="Clave del teléfono (opcional)" value={form.phonePasscode} onChange={e => setForm({ ...form, phonePasscode: e.target.value })} />
        <input className="rounded-lg border bg-background p-2" placeholder="Color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
        <input className="rounded-lg border bg-background p-2" placeholder="Capacidad" value={form.storage} onChange={e => setForm({ ...form, storage: e.target.value })} />
        <input className="rounded-lg border bg-background p-2" placeholder="Notas" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
      </div>
      {selectedClient && <p className="text-xs text-muted-foreground">Se asociará a: <b>{selectedClient.name}</b></p>}
      <button disabled={loading} onClick={createDevice} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{loading ? "Guardando…" : "Registrar equipo"}</button>
    </div>}
    <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><h2 className="font-semibold">Dispositivos registrados <span className="text-muted-foreground">({devices.length})</span></h2><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input className="rounded-lg border bg-background py-2 pl-9 pr-3 text-sm" placeholder="Buscar IMEI, serial, equipo o cliente" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
      <div className="space-y-3">{devices.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No hay equipos registrados.</p> : devices.map(d => <div key={d._id} className="rounded-xl border border-white/10 p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2 font-medium"><Smartphone className="h-4 w-4" />{d.name}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>Cliente: {d.clientName}</span>{d.imei && <span>IMEI: {d.imei}</span>}{d.serial && <span>Serial: {d.serial}</span>}{d.storage && <span>{d.storage}</span>}{d.color && <span>{d.color}</span>}</div></div><span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs"><ShieldCheck className="h-3 w-3" />{d.status === "active" ? "Activo" : d.status || "Activo"}</span></div>{d.notes && <p className="mt-2 text-xs text-muted-foreground">{d.notes}</p>}</div>)}</div>
    </div>
  </div>;
}
