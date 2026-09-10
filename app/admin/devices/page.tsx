"use client";

import { useEffect, useMemo, useState } from "react";
import { Smartphone, Search, Plus, ShieldCheck, Upload, FileText } from "lucide-react";

type Client = { _id: string; name: string; email?: string };
type Device = { _id: string; clientId?: string; clientName: string; name: string; brand?: string; model?: string; imei?: string; imei1?: string; imei2?: string; serial?: string; phonePasscode?: string; color?: string; storage?: string; contact?: string; fmi?: string; notes?: string; status?: string };

const emptyForm = { clientId: "", brand: "", model: "", imei: "", serial: "", phonePasscode: "", color: "", storage: "", contact: "", fmi: "", notes: "" };

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) { current += '"'; i += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if ((char === ";" || char === ",") && !quoted) { values.push(current.trim()); current = ""; continue; }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function parseBulkDevices(csv: string) {
  const lines = csv.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = parseCsvLine(headerLine).map(h => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim());
  const aliases: Record<string, string> = { cliente: "clientName", contacto: "contact", marca: "brand", modelo: "model", nombre: "name", imei: "imei1", imei1: "imei1", imei2: "imei2", serial: "serial", clave: "phonePasscode", "clave del telefono": "phonePasscode", color: "color", capacidad: "storage", almacenamiento: "storage", fmi: "fmi", notas: "notes" };
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { const key = aliases[header] || header; if (key) row[key] = values[index] ?? ""; });
    return row;
  });
}

const bulkTemplate = `Cliente;Contacto;Marca;Modelo;IMEI;Serial;Clave;Color;Capacidad;FMI;Notas
Kevin;3001234567;Apple;iPhone 15 Pro Max;356000000000001;H7H000RXLF;1234;Natural;256GB;Desactivado;Equipo revisado
Kevin;3001234567;Apple;iPhone 16 Pro;356000000000002;;2580;Negro;128GB;Activado;`;

export default function AdminDevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [form, setForm] = useState(emptyForm);

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
      const body = { ...form, clientName: selectedClient?.name || "" };
      const res = await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "No se pudo registrar el equipo");
      setMessage("Equipo registrado correctamente."); setForm(emptyForm); setShowForm(false); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Error registrando equipo"); }
    finally { setLoading(false); }
  }

  async function importBulk() {
    const rows = parseBulkDevices(bulkText);
    if (!rows.length) { setMessage("Pega un CSV con encabezados y al menos una fila de equipos."); return; }
    setBulkLoading(true); setMessage("");
    try {
      const res = await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ devices: rows }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo realizar el ingreso masivo");
      const summary = [`${data.created ?? 0} registrados`];
      if (data.duplicates) summary.push(`${data.duplicates} duplicados`);
      if (data.errors) summary.push(`${data.errors} con errores`);
      setMessage(`Ingreso masivo terminado: ${summary.join(" · ")}.`);
      setBulkText(""); setShowBulk(false); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Error en el ingreso masivo"); }
    finally { setBulkLoading(false); }
  }

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div><h1 className="text-2xl font-semibold flex items-center gap-2"><Smartphone className="h-6 w-6" />Equipos de clientes</h1><p className="text-sm text-muted-foreground">Registra dispositivos por cliente y usa IMEI/serial como identidad técnica.</p></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setShowBulk(v => !v); setShowForm(false); }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[.05] px-4 py-2 text-sm font-semibold"><Upload className="h-4 w-4" />Ingreso masivo</button>
        <button onClick={() => { setShowForm(v => !v); setShowBulk(false); }} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />Nuevo equipo</button>
      </div>
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
        <input className="rounded-lg border bg-background p-2" placeholder="Contacto" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} />
        <select className="rounded-lg border bg-background p-2" value={form.fmi} onChange={e => setForm({ ...form, fmi: e.target.value })}><option value="">FMI</option><option value="Activado">Activado</option><option value="Desactivado">Desactivado</option><option value="No aplica">No aplica</option><option value="No verificado">No verificado</option></select>
        <input className="rounded-lg border bg-background p-2" placeholder="Color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
        <input className="rounded-lg border bg-background p-2" placeholder="Capacidad" value={form.storage} onChange={e => setForm({ ...form, storage: e.target.value })} />
        <input className="rounded-lg border bg-background p-2 lg:col-span-2" placeholder="Notas" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
      </div>
      {selectedClient && <p className="text-xs text-muted-foreground">Se asociará a: <b>{selectedClient.name}</b></p>}
      <button disabled={loading} onClick={createDevice} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{loading ? "Guardando…" : "Registrar equipo"}</button>
    </div>}
    {showBulk && <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5 space-y-4">
      <div className="flex items-start gap-3"><FileText className="mt-1 h-5 w-5" /><div><h2 className="font-semibold">Ingreso masivo de equipos</h2><p className="text-sm text-muted-foreground">Pega datos separados por punto y coma (;) usando los encabezados indicados. Puedes incluir diferentes clientes en cada fila.</p></div></div>
      <textarea className="min-h-[260px] w-full rounded-xl border bg-background p-3 font-mono text-xs" value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder={bulkTemplate} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setBulkText(bulkTemplate)} className="rounded-lg border border-white/10 px-3 py-2 text-sm">Cargar ejemplo</button>
        <button disabled={bulkLoading} onClick={importBulk} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{bulkLoading ? "Importando…" : "Importar equipos"}</button>
      </div>
      <p className="text-xs text-muted-foreground">Columnas: Cliente, Contacto, Marca, Modelo, IMEI, Serial, Clave, Color, Capacidad, FMI, Notas.</p>
    </div>}
    <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><h2 className="font-semibold">Dispositivos registrados <span className="text-muted-foreground">({devices.length})</span></h2><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input className="rounded-lg border bg-background py-2 pl-9 pr-3 text-sm" placeholder="Buscar IMEI, serial, equipo o cliente" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
      <div className="space-y-3">{devices.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No hay equipos registrados.</p> : devices.map(d => <div key={d._id} className="rounded-xl border border-white/10 p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><div className="flex items-center gap-2 font-medium"><Smartphone className="h-4 w-4" />{d.name}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>Cliente: {d.clientName || "Sin cliente"}</span>{d.contact && <span>Contacto: {d.contact}</span>}{d.imei1 && <span>IMEI: {d.imei1}</span>}{d.imei2 && <span>IMEI 2: {d.imei2}</span>}{d.serial && <span>Serial: {d.serial}</span>}{d.storage && <span>{d.storage}</span>}{d.color && <span>{d.color}</span>}{d.fmi && <span>FMI: {d.fmi}</span>}</div></div><span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs"><ShieldCheck className="h-3 w-3" />{d.status === "active" ? "Activo" : d.status || "Activo"}</span></div>{d.notes && <p className="mt-2 text-xs text-muted-foreground">{d.notes}</p>}</div>)}</div>
    </div>
  </div>;
}