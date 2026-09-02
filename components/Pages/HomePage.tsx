"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts";
import ProductList from "@/components/products/ProductList";
import SupplierList from "@/components/supplier/SupplierList";
import CategoryList from "@/components/category/CategoryList";
import { StatisticsSection } from "@/components/home/StatisticsSection";
import Navbar from "@/components/layouts/Navbar";
import { PageContentWrapper } from "@/components/shared";
import FloatingActionButtons from "@/components/shared/FloatingActionButtons";
import { PageSectionHeader } from "@/components/shared";
import { useProducts } from "@/hooks/queries";
import { queryKeys, useSyncSsrQueryData } from "@/lib/react-query";
import type { ProductForHome, CategoryForHome, SupplierForHome } from "@/lib/server/home-data";
import type { DashboardStats } from "@/types";
import { LayoutDashboard, Smartphone, ClipboardList, Package, Wallet } from "lucide-react";

export type HomePageProps = { initialProducts?: ProductForHome[]; initialCategories?: CategoryForHome[]; initialSuppliers?: SupplierForHome[]; initialStats?: DashboardStats | null; initialOAuthSuccess?: boolean; };

export default function HomePage({ initialProducts, initialCategories, initialSuppliers, initialStats, initialOAuthSuccess = false }: HomePageProps = {}) {
  const router = useRouter(); const searchParams = useSearchParams(); const { isLoggedIn, isCheckingAuth, user, refreshSession } = useAuth(); const { data: allProducts = [] } = useProducts(initialProducts);
  useSyncSsrQueryData(queryKeys.products.lists(), initialProducts); useSyncSsrQueryData(queryKeys.categories.lists(), initialCategories); useSyncSsrQueryData(queryKeys.suppliers.lists(), initialSuppliers);
  const [isRefreshingOAuth, setIsRefreshingOAuth] = useState(false), [oauthRefreshComplete, setOauthRefreshComplete] = useState(false); const oauthHandledRef = useRef(false), urlCleanedRef = useRef(false);
  useEffect(() => { const isOAuthFlow = initialOAuthSuccess || searchParams.get("oauth_success") === "true"; if (isOAuthFlow && !oauthHandledRef.current) { oauthHandledRef.current = true; queueMicrotask(() => setIsRefreshingOAuth(true)); refreshSession().then(() => { setOauthRefreshComplete(true); setIsRefreshingOAuth(false); if (!urlCleanedRef.current && typeof window !== "undefined" && window.location.search.includes("oauth_success=true")) { urlCleanedRef.current = true; window.history.replaceState({ ...window.history.state, as: "/", url: "/" }, "", "/"); } }).catch(() => { setOauthRefreshComplete(true); setIsRefreshingOAuth(false); }); return; } if (!isOAuthFlow || oauthRefreshComplete) { if (isOAuthFlow && oauthRefreshComplete) { if (!isCheckingAuth && !isLoggedIn) router.replace("/login", { scroll: false }); return; } if (!isOAuthFlow && !isCheckingAuth && !isLoggedIn) router.replace("/login", { scroll: false }); } }, [initialOAuthSuccess, searchParams, isLoggedIn, isCheckingAuth, router, refreshSession, isRefreshingOAuth, oauthRefreshComplete]);
  return <Navbar><PageContentWrapper><PageSectionHeader as="h2" icon={LayoutDashboard} tone="sky" title="Resumen de la tienda" description={<>Aquí puedes consultar los principales indicadores de tu tienda, incluyendo tu actividad y la actividad de clientes y otros usuarios. Los datos se actualizan automáticamente cuando se realizan cambios. Para consultar únicamente tus pedidos, productos y actividad, visita <Link href="/admin/my-activity" className="font-medium text-sky-600 hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300">Mi actividad</Link>.</>} />
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Link href="/devices" className="group rounded-2xl border bg-background/70 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center gap-3"><Smartphone className="h-5 w-5 text-violet-500" /><div><div className="font-semibold">Equipos DarkPhone</div><div className="text-xs text-muted-foreground">IMEI, garantías y rentabilidad</div></div></div></Link><Link href="/service-orders" className="group rounded-2xl border bg-background/70 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center gap-3"><ClipboardList className="h-5 w-5 text-sky-500" /><div><div className="font-semibold">Servicio técnico</div><div className="text-xs text-muted-foreground">Recibir y seguir equipos en reparación</div></div></div></Link><Link href="/inventory" className="group rounded-2xl border bg-background/70 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center gap-3"><Package className="h-5 w-5 text-emerald-500" /><div><div className="font-semibold">Inventario</div><div className="text-xs text-muted-foreground">Stock, movimientos y ajustes</div></div></div></Link><Link href="/cash" className="group rounded-2xl border bg-background/70 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center gap-3"><Wallet className="h-5 w-5 text-amber-500" /><div><div className="font-semibold">Caja</div><div className="text-xs text-muted-foreground">Movimientos, arqueos y cierres</div></div></div></Link></div>
    <div id="statistics" className="pb-6 scroll-mt-20"><StatisticsSection initialStats={initialStats} /></div><div id="products" className="pb-6 scroll-mt-20"><ProductList initialProducts={initialProducts} /></div><div id="suppliers" className="pb-6 scroll-mt-20"><SupplierList initialSuppliers={initialSuppliers} /></div><div id="categories" className="pb-6 scroll-mt-20"><CategoryList initialCategories={initialCategories} /></div><FloatingActionButtons allProducts={allProducts} userId={user?.id || ""} /></PageContentWrapper></Navbar>;
}
