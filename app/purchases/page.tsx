import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export default async function PurchasesPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <div className="p-6"><h1 className="text-2xl font-semibold">Compras</h1><p className="mt-2 text-muted-foreground">Módulo de compras.</p></div>;
}
