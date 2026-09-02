import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-server";
import DevicePurchasePage from "@/components/Pages/DevicePurchasePage";
import Navbar from "@/components/layouts/Navbar";

export const dynamic = "force-dynamic";
export default async function DevicePurchaseRoute() { const user = await getSession(); if (!user) redirect("/login"); if (user.role === "client" || user.role === "supplier") redirect("/devices"); return <Navbar><DevicePurchasePage /></Navbar>; }
