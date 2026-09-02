import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import DevicesPage from "@/components/Pages/DevicesPage";
import Navbar from "@/components/layouts/Navbar";

export const dynamic = "force-dynamic";

export default async function DevicesRoute() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role === "client") redirect("/client");
  if (user.role === "supplier") redirect("/supplier");
  return <Navbar><DevicesPage /></Navbar>;
}
