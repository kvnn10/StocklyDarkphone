import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import ServiceOrdersWorkspace from "@/components/admin/ServiceOrdersWorkspace";

export const dynamic = "force-dynamic";

export default async function AdminServiceOrdersPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <ServiceOrdersWorkspace />;
}
