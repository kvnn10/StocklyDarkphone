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
  { href: "/admin/dashboard-overall-insights", label: "Store Overview" },
  { href: "/admin/sales", label: "Ventas" },
  { href: "/admin/orders", label: "Orders", countKey: "clientOrders" },
  { href: "/admin/invoices", label: "Invoices", countKey: "clientInvoices" },
  { href: "/admin/support-tickets", label: "Support Tickets", countKey: "supportTickets" },
  { href: "/admin/product-reviews", label: "Product Reviews", countKey: "productReviews" },
];

export const ADMIN_MANAGEMENT_ITEMS: AdminNavItemConfig[] = [
  { href: "/admin/products", label: "Products", countKey: "products" },
  { href: "/admin/warehouses", label: "Warehouses", countKey: "warehouses" },
  { href: "/admin/supplier-portal", label: "Supplier Portal", countKey: "suppliers" },
  { href: "/admin/client-portal", label: "Client Portal", countKey: "clients" },
  { href: "/admin/cash", label: "Caja" },
  { href: "/user-management", label: "User Management", countKey: "users" },
  { href: "/admin/activity-history", label: "Activity History" },
];

export const ADMIN_MY_ACTIVITY_ITEMS: AdminNavItemConfig[] = [
  { href: "/admin/my-activity", label: "My Activity" },
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
