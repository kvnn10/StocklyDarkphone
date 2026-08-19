"use client";

import Link from "next/link";
import { ArrowRight, Boxes, CreditCard, DollarSign, Users } from "lucide-react";
import type { DashboardStats } from "@/types";

export default function AdminBusinessQuickAccess({
  stats,
}: {
  stats?: DashboardStats | null;
}) {
  const cards = [
    {
      href: "/admin/orders",
      label: "Ventas",
      value: stats?.counts?.orders ?? 0,
      description: "Órdenes registradas",
      icon: CreditCard,
      tone: "from-blue-500/20 to-cyan-500/10",
    },
    {
      href: "/admin/client-portal",
      label: "Clientes",
      value: stats?.counts?.users ?? 0,
      description: "Usuarios registrados",
      icon: Users,
      tone: "from-violet-500/20 to-fuchsia-500/10",
    },
    {
      href: "/cash",
      label: "Caja",
      value: "Abrir",
      description: "Ingresos, egresos y movimientos",
      icon: DollarSign,
      tone: "from-emerald-500/20 to-teal-500/10",
    },
    {
      href: "/admin/products",
      label: "Inventario",
      value: stats?.counts?.products ?? 0,
      description: `${stats?.productStatusBreakdown?.stockLow ?? 0} con stock bajo`,
      icon: Boxes,
      tone: "from-amber-500/20 to-orange-500/10",
    },
  ];

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Operación de Stockly</h2>
        <p className="text-sm text-muted-foreground">Accesos rápidos a los módulos principales del negocio.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className={`group rounded-2xl border bg-gradient-to-br ${card.tone} p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-background/80 shadow-sm">
                  <Icon className="h-5 w-5" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </div>
              <div className="mt-4">
                <div className="text-sm font-medium">{card.label}</div>
                <div className="mt-1 text-2xl font-bold">{card.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{card.description}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
