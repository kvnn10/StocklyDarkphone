import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import InventoryHub from "@/components/admin/InventoryHub";

export const dynamic = "force-dynamic";

export default async function AdminInventoryPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <InventoryHub />;
}
