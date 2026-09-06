import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function PurchasesPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  redirect("/admin/purchases");
}
