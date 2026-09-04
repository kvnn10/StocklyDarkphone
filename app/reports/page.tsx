import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import { getDashboardForAdmin } from "@/lib/server/dashboard-data";
import ReportsDashboard from "@/components/reports/ReportsDashboard";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role === "client" || user.role === "supplier") redirect("/");

  const stats = await getDashboardForAdmin(user.id);
  return <ReportsDashboard stats={stats} />;
}
