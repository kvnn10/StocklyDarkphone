"use client";

import { useEffect, useState } from "react";
import { Command, Search, X, Package, Users, ShoppingCart, Smartphone, ArrowRight } from "lucide-react";
import Link from "next/link";

type Result = { type: string; id: string; title: string; subtitle: string; href: string };

const ICONS = { product: Package, client: Users, order: ShoppingCart, device: Smartphone } as const;
const LABELS = { product: "Producto", client: "Cliente", order: "Venta", device: "Equipo" } as const;

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("search");
        const data = await response.json();
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm p-3 sm:p-6" onMouseDown={() => setOpen(false)}>
      <div className="mx-auto mt-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200/70 bg-white/95 shadow-2xl dark:border-white/10 dark:bg-gray-950/95" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-gray-200/70 px-4 py-3 dark:border-white/10">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar productos, clientes, ventas o equipos…"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            aria-label="Búsqueda global"
          />
          <kbd className="hidden rounded border px-2 py-1 text-[11px] text-muted-foreground sm:inline">ESC</kbd>
          <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar búsqueda" className="rounded-md p-1.5 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {loading && <div className="px-3 py-8 text-center text-sm text-muted-foreground">Buscando…</div>}
          {!loading && query.trim().length < 2 && (
            <div className="flex flex-col items-center gap-2 px-3 py-10 text-center text-sm text-muted-foreground">
              <Command className="h-8 w-8" />
              <p>Escribe al menos 2 caracteres.</p>
              <p className="text-xs">Atajo: Ctrl+K en Windows/Linux · ⌘K en Mac</p>
            </div>
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">No encontramos coincidencias.</div>
          )}
          {!loading && results.map((result) => {
            const Icon = ICONS[result.type as keyof typeof ICONS] ?? Search;
            const label = LABELS[result.type as keyof typeof LABELS] ?? "Resultado";
            return (
              <Link key={`${result.type}-${result.id}`} href={result.href} onClick={() => setOpen(false)} className="group flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-muted">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{result.title}</span><span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span></div>
                  <p className="truncate text-xs text-muted-foreground">{result.subtitle}</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
