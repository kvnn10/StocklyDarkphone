"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, CreditCard, DollarSign, FileText, History, Laptop, ReceiptText, Settings2, Users, WalletCards, Wrench } from "lucide-react";
import type { DashboardStats } from "@/types";

type Health = { status: "healthy" | "attention"; inventory: { checked: number; healthy: number; issues: number; blocked: number } };

export default function AdminBusinessQuickAccess({ stats }: { stats?: DashboardStats | null }) {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/health", { credentials: "include", cache: "no-store" }).then((res) => (res.ok ? res.json() : null)).then((data) => { if (active && data?.health) setHealth(data.health); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const cards = [
    { href: "/admin/sales", label: "Ventas", value: stats?.counts?.orders ?? 0, description: "POS, devoluciones, pagos y cotizaciones", icon: CreditCard, tone: "from-blue-500/20 to-cyan-500/10" },
    { href: "/admin/client-portal", label: "Clientes", value: stats?.counts?.users ?? 0, description: "Usuarios registrados", icon: Users, tone: "from-violet-500/20 to-fuchsia-500/10" },
    { href: "/cash", label: "Caja", value: "Abrir", description: "Ingresos, egresos, cierres y arqueos", icon: DollarSign, tone: "from-emerald-500/20 to-teal-500/10" },
    { href: "/admin/products", label: "Inventario", value: stats?.counts?.products ?? 0, description: "Productos, conteos y ajustes", icon: Boxes, tone: "from-amber-500/20 to-orange-500/10" },
    { href: "/devices", label: "Equipos", value: "Abrir", description: "IMEI, seriales, costos, venta y garantía", icon: Laptop, tone: "from-sky-500/20 to-indigo-500/10" },
    { href: "/admin/service-orders", label: "Servicio técnico", value: "Abrir", description: "Reparaciones, repuestos, fotos y garantías", icon: Wrench, tone: "from-fuchsia-500/20 to-pink-500/10" },
    { href: "/admin/invoices", label: "Facturas", value: "Abrir", description: "Facturación y documentos de venta", icon: ReceiptText, tone: "from-cyan-500/20 to-blue-500/10" },
    { href: "/admin/finance", label: "Finanzas", value: "Abrir", description: "Cuentas por cobrar, pagar y gastos", icon: FileText, tone: "from-lime-500/20 to-emerald-500/10" },
    { href: "/admin/payables", label: "CxP proveedores", value: "Abrir", description: "Deudas, pagos y estado de proveedores", icon: WalletCards, tone: "from-rose-500/20 to-orange-500/10" },
    { href: "/admin/kardex", label: "Kardex", value: "Abrir", description: "Historial de movimientos de inventario", icon: History, tone: "from-orange-500/20 to-red-500/10" },
    { href: "/admin/audit", label: "Auditoría", value: "Abrir", description: "Trazabilidad y acciones del sistema", icon: Settings2, tone: "from-slate-500/20 to-zinc-500/10" },
  ];

  return <section className="space-y-3"><div><h2 className="text-lg font-semibold tracking-tight">Operación de Stockly</h2><p className="text-sm text-muted-foreground">Accesos rápidos a los módulos principales del negocio.</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">{cards.map((card) => { const Icon = card.icon; return <Link key={card.href} href={card.href} className={`group rounded-2xl border bg-gradient-to-br ${card.tone} p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg`}><div className="flex items-start justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/80 shadow-sm"><Icon className="h-5 w-5" /></div><ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" /></div><div className="mt-4"><div className="text-sm font-medium">{card.label}</div><div className="mt-1 text-2xl font-bold">{card.value}</div><div className="mt-1 text-xs text-muted-foreground">{card.description}</div></div></Link>; })}</div><div className="rounded-2xl border bg-background p-4 shadow-sm"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3">{health?.status === "attention" ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}<div><div className="text-sm font-semibold">Salud del inventario</div><div className="text-xs text-muted-foreground">{health ? `${health.inventory.healthy}/${health.inventory.checked} productos sin diferencias` : "Comprobando inventario…"}</div></div></div>{health && health.inventory.issues > 0 && <span className="text-xs font-medium">{health.inventory.issues} diferencia{health.inventory.issues === 1 ? "" : "s"}</span>}</div></div></section>;
}
