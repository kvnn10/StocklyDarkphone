import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import SalesPOS from "@/components/admin/SalesPOS";

export const dynamic = "force-dynamic";

export default async function AdminSalesPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <SalesPOS />;
}
