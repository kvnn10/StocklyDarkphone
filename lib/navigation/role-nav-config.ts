import { getAdminSidebarWarmPaths } from "@/lib/navigation/admin-nav-config";

export type RoleNavItem =
  | { label: string; path: string; hasDropdown: false }
  | { label: string; path: string; hasDropdown: true; dropdownItems: Array<{ label: string; path: string }> };

const ADMIN_NAV_ITEMS: RoleNavItem[] = [
  { label: "Panel principal", path: "/", hasDropdown: false },
  { label: "Productos", path: "/products", hasDropdown: false },
  { label: "Pedidos", path: "/orders", hasDropdown: false },
  { label: "Clientes", path: "/clients", hasDropdown: false },
  { label: "Facturas", path: "/invoices", hasDropdown: false },
  { label: "Movimientos", path: "/inventory-movements", hasDropdown: false },
  { label: "Caja", path: "/admin/cash", hasDropdown: false },
  { label: "Servicio técnico", path: "/admin/service-orders", hasDropdown: false },
  { label: "Análisis del negocio", path: "/business-insights", hasDropdown: false },
  { label: "Panel de administración", path: "/admin", hasDropdown: false },
];

const CLIENT_NAV_ITEMS: RoleNavItem[] = [
  { label: "Portal del cliente", path: "/client", hasDropdown: false },
  { label: "Ver productos", path: "/products", hasDropdown: false },
  { label: "Mis pedidos", path: "/orders", hasDropdown: false },
  { label: "Mis facturas", path: "/invoices", hasDropdown: false },
];

const SUPPLIER_NAV_ITEMS: RoleNavItem[] = [
  { label: "Portal del proveedor", path: "/supplier", hasDropdown: false },
  { label: "Mis productos", path: "/products", hasDropdown: false },
  { label: "Ver pedidos", path: "/orders", hasDropdown: false },
  { label: "Facturas relacionadas", path: "/invoices", hasDropdown: false },
];

export function getNavItemsForRole(role: string | null | undefined): RoleNavItem[] {
  if (role === "client") return CLIENT_NAV_ITEMS;
  if (role === "supplier") return SUPPLIER_NAV_ITEMS;
  return ADMIN_NAV_ITEMS;
}
export function getNavPathsForRole(role: string | null | undefined): string[] { return getNavItemsForRole(role).map((item) => item.path); }
export const PROFILE_MENU_PATHS = ["/support-tickets", "/settings/email-preferences", "/api-docs", "/api-status"] as const;
export function getProfileMenuPaths(): string[] { return [...PROFILE_MENU_PATHS]; }
function resolveWarmNavPath(path: string): string { return path === "/admin" ? "/admin/dashboard-overall-insights" : path; }
export function getWarmPathsForRole(role: string | null | undefined): string[] {
  const paths = [...getNavPathsForRole(role).map(resolveWarmNavPath), ...getProfileMenuPaths()];
  if (role !== "client" && role !== "supplier") paths.push(...getAdminSidebarWarmPaths());
  return [...new Set(paths)];
}
export function getHomePathForRole(role: string | null | undefined): string { if (role === "client") return "/client"; if (role === "supplier") return "/supplier"; return "/"; }
