import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import StockDistributionPage from "@/components/stock/StockDistributionPage";

export const dynamic = "force-dynamic";

export default async function StockDistributionRoute() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <StockDistributionPage />;
}
