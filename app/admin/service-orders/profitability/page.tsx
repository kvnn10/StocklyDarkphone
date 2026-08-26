import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import ServiceOrderProfitability from "@/components/admin/ServiceOrderProfitability";

export const dynamic = "force-dynamic";

export default async function ServiceOrderProfitabilityPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <ServiceOrderProfitability />;
}
