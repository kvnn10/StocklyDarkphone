"use client";

import React from "react";
import { PageContentWrapper } from "@/components/shared";
import AdminAnalyticsContent from "./AdminAnalyticsContent";
import AdminBusinessQuickAccess from "./AdminBusinessQuickAccess";
import AdminOperationalHealthCard from "./AdminOperationalHealthCard";
import ServiceProfitabilityDashboardCard from "./ServiceProfitabilityDashboardCard";
import type { DashboardStats } from "@/types";

export type AdminDashboardMergedViewProps = {
  variant: "store" | "personal";
  /** SSR-passed dashboard stats (REQ-0021) */
  initialStats?: DashboardStats | null;
  /** SSR-passed forecasting summary (REQ-0025) */
  initialForecasting?: import("@/types").ForecastingSummary;
};

/**
 * Merged dashboard: overview (KPIs + recent orders) + analytics (charts, AI)
 * + operational inventory health + service profitability.
 */
export default function AdminDashboardMergedView({
  variant,
  initialStats,
  initialForecasting,
}: AdminDashboardMergedViewProps) {
  return (
    <PageContentWrapper noPadding={variant === "store"}>
      <div className="space-y-6">
        <AdminBusinessQuickAccess stats={initialStats} />
        {variant === "store" && <AdminOperationalHealthCard />}
        {variant === "store" && <ServiceProfitabilityDashboardCard />}
        <AdminAnalyticsContent
          initialStats={initialStats}
          initialForecasting={initialForecasting}
        />
      </div>
    </PageContentWrapper>
  );
}
