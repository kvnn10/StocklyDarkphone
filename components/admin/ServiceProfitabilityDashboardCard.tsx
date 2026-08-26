"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CircleDollarSign, Package, TrendingUp, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Summary = {
  orders: number;
  revenue: number;
  partsCost: number;
  labor: number;
  grossProfit: number;
  averageMargin: number;
};

const money = (value: number) => `$${Math.round(Number(value || 0)).toLocaleString("es-CO")}`;

export default function ServiceProfitabilityDashboardCard() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/service-orders/profitability", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json();
        return data?.summary as Summary | undefined;
      })
      .then((data) => {
        if (active && data) setSummary(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const profit = summary?.grossProfit ?? 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Rentabilidad de reparaciones
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Resultado de Servicio Técnico usando el costo real de repuestos.
          </p>
        </div>
        <Link href="/admin/service-orders/profitability" className="inline-flex items-center gap-1 text-sm font-medium hover:underline">
          Ver detalle <ArrowRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent>
        {!summary ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {["Órdenes", "Facturación", "Costo repuestos", "Utilidad", "Margen"].map((label) => (
              <div key={label} className="rounded-xl border p-3 animate-pulse">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="mt-3 h-6 w-28 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Mini icon={Wrench} label="Órdenes" value={String(summary.orders)} />
            <Mini icon={CircleDollarSign} label="Facturación" value={money(summary.revenue)} />
            <Mini icon={Package} label="Costo repuestos" value={money(summary.partsCost)} />
            <Mini icon={TrendingUp} label="Utilidad bruta" value={money(profit)} positive={profit >= 0} />
            <Mini icon={TrendingUp} label="Margen" value={`${summary.averageMargin.toFixed(1)}%`} positive={summary.averageMargin >= 0} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Mini({ icon: Icon, label, value, positive }: { icon: typeof Wrench; label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className={`mt-2 text-lg font-semibold ${positive ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{value}</div>
    </div>
  );
}
