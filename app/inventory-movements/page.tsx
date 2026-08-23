import { redirect } from "next/navigation";
import { getSessionFromRequest } from "@/utils/auth";
import { headers } from "next/headers";
import InventoryMovementsClient from "@/components/inventory/InventoryMovementsClient";

export default async function InventoryMovementsPage() {
  const requestHeaders = await headers();
  const session = await getSessionFromRequest(new Request("http://localhost/inventory-movements", { headers: requestHeaders }));
  if (!session) redirect("/login");
  return <InventoryMovementsClient />;
}
