import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import InventoryMovementsClient from "@/components/inventory/InventoryMovementsClient";

export const dynamic = "force-dynamic";

export default async function InventoryMovementsRoute() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <InventoryMovementsClient />;
}
