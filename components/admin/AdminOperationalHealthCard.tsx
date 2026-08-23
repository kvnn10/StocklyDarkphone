"use client";

import { useEffect, useState } from "react";

interface HealthResponse {
  health?: {
    status?: "healthy" | "attention";
    inventory?: {
      checked?: number;
      healthy?: number;
      issues?: number;
      blocked?: number;
    };
  };
}

export default function AdminOperationalHealthCard() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/health", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("health request failed");
        return response.json() as Promise<HealthResponse>;
      })
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const status = data?.health?.status;
  const inventory = data?.health?.inventory;
  const isHealthy = status === "healthy";

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm" aria-live="polite">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Estado operativo</p>
          <h2 className="mt-1 text-lg font-semibold">Salud del inventario</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Verificación automática sin modificar existencias.
          </p>
        </div>

        {loading ? (
          <span className="inline-flex w-fit rounded-full border px-3 py-1 text-sm text-muted-foreground">
            Verificando…
          </span>
        ) : (
          <span
            className={`inline-flex w-fit rounded-full border px-3 py-1 text-sm font-medium ${
              isHealthy
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            }`}
          >
            {isHealthy ? "✓ Todo en orden" : "⚠ Requiere atención"}
          </span>
        )}
      </div>

      {!loading && data && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Revisados" value={inventory?.checked ?? 0} />
          <Metric label="Correctos" value={inventory?.healthy ?? 0} />
          <Metric label="Diferencias" value={inventory?.issues ?? 0} />
          <Metric label="Bloqueados" value={inventory?.blocked ?? 0} />
        </div>
      )}

      {!loading && !data && (
        <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          No fue posible consultar el estado operativo. Los datos del Dashboard no se modificaron.
        </p>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
