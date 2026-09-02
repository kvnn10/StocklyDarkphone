"use client";

import React from "react";
import { PageContentWrapper } from "@/components/shared";
import AdminAnalyticsContent from "./AdminAnalyticsContent";
import AdminBusinessQuickAccess from "./AdminBusinessQuickAccess";
import AdminOperationalHealthCard from "./AdminOperationalHealthCard";
import AdminPaymentReconciliationCard from "./AdminPaymentReconciliationCard";
import ServiceProfitabilityDashboardCard from "./ServiceProfitabilityDashboardCard";
import AdminProfitabilityCard from "./AdminProfitabilityCard";
import InventoryIntelligenceCard from "./InventoryIntelligenceCard";
import type { DashboardStats } from "@/types";

export type AdminDashboardMergedViewProps = {
  variant: "store" | "personal";
  initialStats?: DashboardStats | null;
  initialForecasting?: import("@/types").ForecastingSummary;
};

/** Merged dashboard: KPIs + operational reconciliation + analytics + profitability. */
export default function AdminDashboardMergedView({ variant, initialStats, initialForecasting }: AdminDashboardMergedViewProps) {
  return (
    <PageContentWrapper noPadding={variant === "store"}>
      <div className="space-y-6">
        <AdminBusinessQuickAccess stats={initialStats} />
        {variant === "store" && <AdminOperationalHealthCard />}
        {variant === "store" && <AdminPaymentReconciliationCard />}
        {variant === "store" && <AdminProfitabilityCard />}
        {variant === "store" && <InventoryIntelligenceCard />}
        {variant === "store" && <ServiceProfitabilityDashboardCard />}
        <AdminAnalyticsContent initialStats={initialStats} initialForecasting={initialForecasting} />
      </div>
    </PageContentWrapper>
  );
}
