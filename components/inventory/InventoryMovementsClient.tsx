"use client";

import { useEffect, useMemo, useState } from "react";

type Movement = {
  id: string;
  productId: string;
  warehouseId: string;
  type: string;
  quantity: string;
  previousStock: string;
  newStock: string;
  reason: string | null;
  referenceId: string | null;
  notes: string | null;
  createdAt: string;
};

const labels: Record<string, string> = {
  entry: "Entrada",
  exit: "Salida",
  adjustment: "Ajuste",
  transfer_in: "Transferencia entrada",
  transfer_out: "Transferencia salida",
};

export default function InventoryMovementsClient() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [type, setType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = type === "all" ? "" : `?type=${encodeURIComponent(type)}`;
      const response = await fetch(`/api/inventory-movements${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar los movimientos");
      setMovements(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando movimientos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [type]);

  const totals = useMemo(() => ({
    entries: movements.filter((m) => m.type === "entry").length,
    exits: movements.filter((m) => m.type === "exit").length,
    adjustments: movements.filter((m) => m.type === "adjustment").length,
  }), [movements]);

  return (
    <main className="mx-auto w-full max-w-7xl p-6">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Movimientos de inventario</h1>
          <p className="mt-1 text-sm text-muted-foreground">Entradas, salidas, ajustes y transferencias.</p>
        </div>
        <select className="rounded-lg border bg-background px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">Todos</option>
          <option value="entry">Entradas</option>
          <option value="exit">Salidas</option>
          <option value="adjustment">Ajustes</option>
          <option value="transfer_in">Transferencias de entrada</option>
          <option value="transfer_out">Transferencias de salida</option>
        </select>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border p-4"><div className="text-sm text-muted-foreground">Entradas</div><div className="mt-1 text-2xl font-semibold">{totals.entries}</div></div>
        <div className="rounded-xl border p-4"><div className="text-sm text-muted-foreground">Salidas</div><div className="mt-1 text-2xl font-semibold">{totals.exits}</div></div>
        <div className="rounded-xl border p-4"><div className="text-sm text-muted-foreground">Ajustes</div><div className="mt-1 text-2xl font-semibold">{totals.adjustments}</div></div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-500/30 p-4 text-sm">{error}</div>}
      <div className="overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30"><tr><th className="px-4 py-3 text-left">Fecha</th><th className="px-4 py-3 text-left">Tipo</th><th className="px-4 py-3 text-right">Cantidad</th><th className="px-4 py-3 text-right">Stock anterior</th><th className="px-4 py-3 text-right">Stock nuevo</th><th className="px-4 py-3 text-left">Motivo</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="px-4 py-10 text-center">Cargando movimientos…</td></tr> : movements.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No hay movimientos todavía.</td></tr> : movements.map((movement) => (
                <tr key={movement.id} className="border-b last:border-0">
                  <td className="px-4 py-3">{new Date(movement.createdAt).toLocaleString("es-CO")}</td>
                  <td className="px-4 py-3 font-medium">{labels[movement.type] ?? movement.type}</td>
                  <td className="px-4 py-3 text-right">{movement.quantity}</td>
                  <td className="px-4 py-3 text-right">{movement.previousStock}</td>
                  <td className="px-4 py-3 text-right font-medium">{movement.newStock}</td>
                  <td className="px-4 py-3">{movement.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
