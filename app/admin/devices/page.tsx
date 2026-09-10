"use client";

import { useEffect, useMemo, useState } from "react";
import { Smartphone, Search, Plus, Upload, FileText, MoreHorizontal, Phone, KeyRound, Palette, HardDrive, UserRound, Copy, Pencil, Trash2, X, Check } from "lucide-react";

type Device = { id: string; clientName: string; name: string; brand?: string; model?: string; imei?: string; imei1?: string; imei2?: string; serial?: string; phonePasscode?: string; passcodeSet?: boolean; color?: string; storage?: string; contact?: string; fmi?: string; notes?: string; status?: string };
type DeviceForm = { name: string; clientName: string; brand: string; model: string; imei: string; imei2: string; serial: string; phonePasscode: string; color: string; storage: string; contact: string; fmi: string; notes: string; status: string };

const emptyForm: DeviceForm = { name: "", clientName: "", brand: "", model: "", imei: "", imei2: "", serial: "", phonePasscode: "", color: "", storage: "", contact: "", fmi: "", notes: "", status: "available" };
const statusLabel: Record<string, string> = { available: "Disponible", active: "Activo", in_service: "En servicio", sold: "Vendido", delivered: "Entregado" };
const statusOptions = Object.entries(statusLabel);

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
  const aliases: Record<string, string> = { cliente: "clientName", contacto: "contact", marca: "brand", modelo: "model", nombre: "name", imei: "imei1", imei1: "imei1", imei2: "imei2", serial: "serial", clave: "phonePasscode", "clave del telefono": "phonePasscode", color: "color", capacidad: "storage", almacenamiento: "storage", fmi: "fmi", estado: "status", notas: "notes" };
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { const key = aliases[header] || header; if (key) row[key] = values[index] ?? ""; });
    const p = (row.phonePasscode || "").trim().toLowerCase();
    if (/^(4|6)\s*d[ií]gitos?$/.test(p)) { row.phonePasscode = ""; row.notes = [row.notes, p.startsWith("4") ? "Clave de 4 dígitos" : "Clave de 6 dígitos"].filter(Boolean).join(" · "); }
    return row;
  });
}

const bulkTemplate = `Cliente;Contacto;Marca;Modelo;IMEI;Serial;Clave;Color;Capacidad;FMI;Estado;Notas
Kevin;3001234567;Apple;iPhone 15 Pro Max;356000000000001;H7H000RXLF;1234;Natural;256GB;Desactivado;Disponible;Equipo revisado
Kevin;3001234567;Apple;iPhone 16 Pro;356000000000002;;2580;Negro;128GB;Activado;En servicio;`;

function toForm(d: Device): DeviceForm {
  return { name: d.name || "", clientName: d.clientName || "", brand: d.brand || "", model: d.model || "", imei: d.imei1 || d.imei || "", imei2: d.imei2 || "", serial: d.serial || "", phonePasscode: "", color: d.color || "", storage: d.storage || "", contact: d.contact || "", fmi: d.fmi || "", notes: d.notes || "", status: d.status || "available" };
}

export default function AdminDevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [form, setForm] = useState<DeviceForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/devices?search=${encodeURIComponent(search)}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No se pudieron cargar los equipos");
    setDevices(data.devices || []);
  }

  useEffect(() => { load().catch(e => setMessage(e instanceof Error ? e.message : "Error cargando equipos")); }, [search]);

  const filteredDevices = useMemo(() => statusFilter === "all" ? devices : devices.filter(d => d.status === statusFilter), [devices, statusFilter]);
  const stats = useMemo(() => ({
    total: devices.length,
    available: devices.filter(d => d.status === "available").length,
    service: devices.filter(d => d.status === "in_service").length,
    fmi: devices.filter(d => (d.fmi || "").toLowerCase() === "activado").length,
  }), [devices]);

  function updateForm<K extends keyof DeviceForm>(key: K, value: DeviceForm[K]) { setForm(current => ({ ...current, [key]: value })); }

  function startCreate() {
    setEditingId(null); setForm(emptyForm); setShowForm(true); setShowBulk(false); setMenuId(null);
  }

  function startEdit(d: Device) {
    setEditingId(d.id); setForm(toForm(d)); setShowForm(false); setShowBulk(false); setMenuId(null);
    requestAnimationFrame(() => document.getElementById(`device-${d.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  function cancelEdit() { setEditingId(null); setForm(emptyForm); }

  async function saveDevice(id?: string) {
    if ((!form.imei.trim() && !form.serial.trim()) || (!form.brand.trim() && !form.model.trim())) {
      setMessage("Indica el equipo y registra IMEI o serial."); return;
    }
    setLoading(true); setMessage("");
    try {
      const body: Record<string, string> = { ...form };
      if (id && !form.phonePasscode) delete body.phonePasscode;
      const res = await fetch("/api/devices", { method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { ...body, id } : body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar el equipo");
      setMessage(id ? "Equipo actualizado correctamente." : "Equipo registrado correctamente.");
      setEditingId(null); setForm(emptyForm); setShowForm(false); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Error guardando equipo"); }
    finally { setLoading(false); }
  }

  async function removeDevice(d: Device) {
    setMenuId(null);
    if (!window.confirm(`¿Eliminar ${d.name}? El equipo se archivará y dejará de aparecer en el inventario.`)) return;
    try {
      const res = await fetch(`/api/devices?id=${encodeURIComponent(d.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo eliminar el equipo");
      setMessage("Equipo eliminado correctamente.");
      if (editingId === d.id) cancelEdit();
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Error eliminando equipo"); }
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
      setMessage(`Ingreso masivo terminado: ${summary.join(" · ")}.`); setBulkText(""); setShowBulk(false); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Error en el ingreso masivo"); }
    finally { setBulkLoading(false); }
  }

  function copy(value: string) { if (value) navigator.clipboard?.writeText(value); }

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div><h1 className="text-2xl font-semibold flex items-center gap-2"><Smartphone className="h-6 w-6" />Equipos de clientes</h1><p className="text-sm text-muted-foreground">Control de equipos, datos técnicos y estado de cada dispositivo.</p></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setShowBulk(v => !v); setShowForm(false); setEditingId(null); }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[.05] px-4 py-2 text-sm font-semibold"><Upload className="h-4 w-4" />Ingreso masivo</button>
        <button onClick={startCreate} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />Nuevo equipo</button>
      </div>
    </div>

    {message && <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">{message}</div>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[["Total de equipos", stats.total, "Todos los dispositivos"], ["Disponibles", stats.available, "Listos para entregar"], ["En servicio", stats.service, "Actualmente en reparación"], ["FMI activado", stats.fmi, "Requieren atención"]].map(([label, value, hint]) => <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[.03] p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div><div className="mt-1 text-xs text-muted-foreground">{hint}</div></div>)}
    </div>

    {showForm && <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5 space-y-4">
      <div className="flex items-center justify-between"><h2 className="font-semibold">Registrar equipo</h2><button onClick={() => setShowForm(false)} className="rounded-lg p-2 hover:bg-white/5"><X className="h-4 w-4" /></button></div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <input className="rounded-lg border bg-background p-2" placeholder="Nombre del equipo" value={form.name} onChange={e => updateForm("name", e.target.value)} />
        <input className="rounded-lg border bg-background p-2" placeholder="Cliente" value={form.clientName} onChange={e => updateForm("clientName", e.target.value)} />
        <input className="rounded-lg border bg-background p-2" placeholder="Marca" value={form.brand} onChange={e => updateForm("brand", e.target.value)} />
        <input className="rounded-lg border bg-background p-2" placeholder="Modelo" value={form.model} onChange={e => updateForm("model", e.target.value)} />
        <input className="rounded-lg border bg-background p-2" placeholder="IMEI" value={form.imei} onChange={e => updateForm("imei", e.target.value)} />
        <input className="rounded-lg border bg-background p-2" placeholder="IMEI 2" value={form.imei2} onChange={e => updateForm("imei2", e.target.value)} />
        <input className="rounded-lg border bg-background p-2" placeholder="Serial" value={form.serial} onChange={e => updateForm("serial", e.target.value)} />
        <input className="rounded-lg border bg-background p-2" inputMode="numeric" maxLength={8} placeholder="Clave del teléfono" value={form.phonePasscode} onChange={e => updateForm("phonePasscode", e.target.value)} />
        <input className="rounded-lg border bg-background p-2" placeholder="Contacto" value={form.contact} onChange={e => updateForm("contact", e.target.value)} />
        <select className="rounded-lg border bg-background p-2" value={form.fmi} onChange={e => updateForm("fmi", e.target.value)}><option value="">FMI</option><option>Activado</option><option>Desactivado</option><option>No aplica</option><option>No verificado</option></select>
        <select className="rounded-lg border bg-background p-2" value={form.status} onChange={e => updateForm("status", e.target.value)}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <input className="rounded-lg border bg-background p-2" placeholder="Color" value={form.color} onChange={e => updateForm("color", e.target.value)} />
        <input className="rounded-lg border bg-background p-2" placeholder="Capacidad" value={form.storage} onChange={e => updateForm("storage", e.target.value)} />
        <input className="rounded-lg border bg-background p-2 lg:col-span-2" placeholder="Notas" value={form.notes} onChange={e => updateForm("notes", e.target.value)} />
      </div>
      <button disabled={loading} onClick={() => saveDevice()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{loading ? "Guardando…" : "Registrar equipo"}</button>
    </div>}

    {showBulk && <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5 space-y-4">
      <div className="flex items-start gap-3"><FileText className="mt-1 h-5 w-5" /><div><h2 className="font-semibold">Ingreso masivo de equipos</h2><p className="text-sm text-muted-foreground">Pega datos separados por punto y coma (;) usando los encabezados indicados.</p></div></div>
      <textarea className="min-h-[260px] w-full rounded-xl border bg-background p-3 font-mono text-xs" value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder={bulkTemplate} />
      <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setBulkText(bulkTemplate)} className="rounded-lg border border-white/10 px-3 py-2 text-sm">Cargar ejemplo</button><button disabled={bulkLoading} onClick={importBulk} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{bulkLoading ? "Importando…" : "Importar equipos"}</button></div>
      <p className="text-xs text-muted-foreground">Columnas: Cliente, Contacto, Marca, Modelo, IMEI, Serial, Clave, Color, Capacidad, FMI, Estado, Notas. “4 dígitos” y “6 dígitos” se convierten automáticamente en una nota.</p>
    </div>}

    <div className="rounded-2xl border border-white/10 bg-white/[.03] overflow-visible">
      <div className="border-b border-white/10 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div><h2 className="font-semibold">Inventario de equipos <span className="text-muted-foreground">({filteredDevices.length})</span></h2><p className="text-xs text-muted-foreground mt-1">Edita los datos directamente desde cada equipo usando “Editar”.</p></div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input className="w-full sm:w-72 rounded-lg border bg-background py-2 pl-9 pr-3 text-sm" placeholder="Buscar IMEI, serial, equipo o cliente" value={search} onChange={e => setSearch(e.target.value)} /></div>
            <select className="rounded-lg border bg-background px-3 py-2 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">Todos los estados</option>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
        </div>
      </div>

      <div className="divide-y divide-white/10">
        {filteredDevices.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No hay equipos que coincidan con el filtro.</p> : filteredDevices.map(d => {
          const status = statusLabel[d.status || ""] || d.status || "Disponible";
          const isEditing = editingId === d.id;
          return <div id={`device-${d.id}`} key={d.id} className="group p-4 transition-colors hover:bg-white/[.025]">
            {isEditing ? <div className="rounded-xl border border-primary/30 bg-black/10 p-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <input className="rounded-lg border bg-background p-2" placeholder="Nombre del equipo" value={form.name} onChange={e => updateForm("name", e.target.value)} />
                <input className="rounded-lg border bg-background p-2" placeholder="Cliente" value={form.clientName} onChange={e => updateForm("clientName", e.target.value)} />
                <input className="rounded-lg border bg-background p-2" placeholder="Marca" value={form.brand} onChange={e => updateForm("brand", e.target.value)} />
                <input className="rounded-lg border bg-background p-2" placeholder="Modelo" value={form.model} onChange={e => updateForm("model", e.target.value)} />
                <input className="rounded-lg border bg-background p-2" placeholder="IMEI" value={form.imei} onChange={e => updateForm("imei", e.target.value)} />
                <input className="rounded-lg border bg-background p-2" placeholder="IMEI 2" value={form.imei2} onChange={e => updateForm("imei2", e.target.value)} />
                <input className="rounded-lg border bg-background p-2" placeholder="Serial" value={form.serial} onChange={e => updateForm("serial", e.target.value)} />
                <input className="rounded-lg border bg-background p-2" inputMode="numeric" maxLength={8} placeholder="Nueva clave (opcional)" value={form.phonePasscode} onChange={e => updateForm("phonePasscode", e.target.value)} />
                <input className="rounded-lg border bg-background p-2" placeholder="Contacto" value={form.contact} onChange={e => updateForm("contact", e.target.value)} />
                <select className="rounded-lg border bg-background p-2" value={form.fmi} onChange={e => updateForm("fmi", e.target.value)}><option value="">FMI</option><option>Activado</option><option>Desactivado</option><option>No aplica</option><option>No verificado</option></select>
                <select className="rounded-lg border bg-background p-2" value={form.status} onChange={e => updateForm("status", e.target.value)}>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <input className="rounded-lg border bg-background p-2" placeholder="Color" value={form.color} onChange={e => updateForm("color", e.target.value)} />
                <input className="rounded-lg border bg-background p-2" placeholder="Capacidad" value={form.storage} onChange={e => updateForm("storage", e.target.value)} />
                <input className="rounded-lg border bg-background p-2 lg:col-span-2" placeholder="Notas" value={form.notes} onChange={e => updateForm("notes", e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2"><button disabled={loading} onClick={() => saveDevice(d.id)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Check className="h-4 w-4" />{loading ? "Guardando…" : "Guardar cambios"}</button><button disabled={loading} onClick={cancelEdit} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm"><X className="h-4 w-4" />Cancelar</button></div>
              <p className="text-xs text-muted-foreground">La clave actual no se muestra. Déjala vacía para conservarla.</p>
            </div> : <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
              <div className="flex min-w-0 flex-1 gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[.05]"><Smartphone className="h-7 w-7 text-muted-foreground" /></div>
                <div className="min-w-0 flex-1">
                  <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_190px_110px] lg:items-center">
                    <div><h3 className="font-semibold text-base">{d.name}</h3><div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{d.clientName || "Sin cliente"}</span>{d.contact && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{d.contact}</span>}{d.color && <span className="inline-flex items-center gap-1"><Palette className="h-3.5 w-3.5" />{d.color}</span>}{d.storage && <span className="inline-flex items-center gap-1"><HardDrive className="h-3.5 w-3.5" />{d.storage}</span>}</div></div>
                    <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Estado</div><div className="mt-0.5 text-xs font-medium">{status}</div></div>
                    <div className="relative justify-self-start lg:justify-self-end">
                      <button onClick={() => setMenuId(menuId === d.id ? null : d.id)} className="rounded-lg border border-white/10 p-2 text-muted-foreground hover:bg-white/5 hover:text-foreground" title="Más opciones"><MoreHorizontal className="h-4 w-4" /></button>
                      {menuId === d.id && <div className="absolute right-0 top-11 z-50 w-44 rounded-xl border border-white/10 bg-background p-1 shadow-2xl">
                        <button onClick={() => startEdit(d)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5"><Pencil className="h-4 w-4" />Editar</button>
                        <button onClick={() => removeDevice(d)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-white/5"><Trash2 className="h-4 w-4" />Eliminar</button>
                      </div>}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {d.imei1 && <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">IMEI</div><div className="mt-0.5 flex items-center gap-1 text-xs font-mono"><span className="truncate">{d.imei1}</span><button onClick={() => copy(d.imei1 || "")} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"><Copy className="h-3 w-3" /></button></div></div>}
                    {d.serial && <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Serial</div><div className="mt-0.5 truncate text-xs font-mono">{d.serial}</div></div>}
                    <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Clave</div><div className="mt-0.5 flex items-center gap-1 text-xs"><KeyRound className="h-3 w-3" />{d.passcodeSet ? "Registrada" : "No registrada"}</div></div>
                    <div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">FMI</div><div className="mt-0.5 text-xs">{d.fmi || "No indicado"}</div></div>
                  </div>
                  {d.imei2 && <div className="mt-2 text-xs text-muted-foreground">IMEI 2: <span className="font-mono">{d.imei2}</span></div>}
                  {d.notes && <p className="mt-2 text-xs text-muted-foreground">{d.notes}</p>}
                </div>
              </div>
            </div>}
          </div>;
        })}
      </div>
    </div>
  </div>;
}
