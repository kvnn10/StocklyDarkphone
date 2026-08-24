/**
 * Admin sidebar nav config.
 * Single source for AdminSidebar hrefs and RouteWarmPrefetch admin RSC warm.
 */

import type { AdminCounts } from "@/types";

export type AdminNavItemConfig = {
  href: string;
  label: string;
  countKey?: keyof Pick<
    AdminCounts,
    | "clientOrders"
    | "clientInvoices"
    | "supportTickets"
    | "productReviews"
    | "products"
    | "warehouses"
    | "suppliers"
    | "clients"
    | "users"
  >;
};

export const ADMIN_MY_STORE_ITEMS: AdminNavItemConfig[] = [
  { href: "/admin/dashboard-overall-insights", label: "Resumen de la tienda" },
  { href: "/admin/sales", label: "Ventas" },
  { href: "/admin/orders", label: "Pedidos", countKey: "clientOrders" },
  { href: "/admin/invoices", label: "Facturas", countKey: "clientInvoices" },
  { href: "/admin/support-tickets", label: "Tickets de soporte", countKey: "supportTickets" },
  { href: "/admin/product-reviews", label: "Reseñas de productos", countKey: "productReviews" },
];

export const ADMIN_MANAGEMENT_ITEMS: AdminNavItemConfig[] = [
  { href: "/admin/products", label: "Productos", countKey: "products" },
  { href: "/admin/warehouses", label: "Almacenes", countKey: "warehouses" },
  { href: "/admin/supplier-portal", label: "Portal de proveedores", countKey: "suppliers" },
  { href: "/admin/client-portal", label: "Portal de clientes", countKey: "clients" },
  { href: "/admin/cash", label: "Caja" },
  { href: "/admin/service-orders", label: "Servicio técnico" },
  // Keep the compatibility route introduced in the latest user-management fix.
  // /user-management redirects to /admin/user-management.
  { href: "/user-management", label: "Gestión de usuarios", countKey: "users" },
  { href: "/admin/activity-history", label: "Historial de actividad" },
];

export const ADMIN_MY_ACTIVITY_ITEMS: AdminNavItemConfig[] = [
  { href: "/admin/my-activity", label: "Mi actividad" },
];

export const ADMIN_SETTINGS_EMAIL_HREF = "/admin/settings/email-preferences";

export function getAdminSidebarWarmPaths(): string[] {
  const paths = [
    ...ADMIN_MY_STORE_ITEMS.map((item) => item.href),
    ...ADMIN_MANAGEMENT_ITEMS.map((item) => item.href),
    ...ADMIN_MY_ACTIVITY_ITEMS.map((item) => item.href),
    ADMIN_SETTINGS_EMAIL_HREF,
  ];
  return [...new Set(paths)];
}
