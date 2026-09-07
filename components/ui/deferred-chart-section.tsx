"use client";

import React, { type ReactNode } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { DataSlotPulse } from "@/components/shared";

export type DeferredChartSectionProps = {
  /** Data slot still loading (SSR or TanStack fetch) */
  loading?: boolean;
  /** Chart has at least one data point */
  hasData: boolean;
  emptyMessage?: ReactNode;
  pulseClassName?: string;
  children: ReactNode;
};

/** REQ-0026 — shared Recharts hydration gate for portal/dashboard pages. */
export function DeferredChartSection({ loading = false, hasData, emptyMessage = <p className="text-muted-foreground text-center py-8">Sin datos todavía</p>, pulseClassName = "min-h-[240px]", children }: DeferredChartSectionProps) {
  const mounted = useMounted();
  if (loading || !mounted) return <DataSlotPulse variant="chart" className={pulseClassName} />;
  if (!hasData) return <>{emptyMessage}</>;
  return <>{children}</>;
}