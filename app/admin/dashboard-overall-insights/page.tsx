import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import { getDashboardForAdmin } from "@/lib/server/dashboard-data";
import { getForecastingForUser } from "@/lib/server/forecasting-data";
import { cacheKeys, invalidateCache } from "@/lib/cache";
import AdminDashboardMergedView from "@/components/admin/AdminDashboardMergedView";

/** Store Dashboard & Analytics — blocking SSR (REQ-0025, no Suspense flash). */
export const dynamic = "force-dynamic";

export default async function StoreDashboardPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  // The overview is the source of truth for the store KPI cards. Invalidate
  // this admin's exact dashboard snapshot before the SSR read so a previous
  // Redis value can never make Total Value disagree with inventory.
  await invalidateCache(cacheKeys.dashboard.overview(user.id));

  const [initialStats, initialForecasting] = await Promise.all([
    getDashboardForAdmin(user.id),
    getForecastingForUser(user.id),
  ]);

  return (
    <AdminDashboardMergedView
      variant="store"
      initialStats={initialStats}
      initialForecasting={initialForecasting}
    />
  );
}
