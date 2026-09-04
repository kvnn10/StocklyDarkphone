/** Central RBAC policy for Stockly/DarkPhone. Server-side callers should enforce these permissions. */
export const ROLES = ["admin", "gerente", "vendedor", "tecnico", "cajero"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  products: ["read", "create", "update", "delete", "adjust_stock"] as const,
  sales: ["read", "create", "update", "cancel", "refund", "discount"] as const,
  purchases: ["read", "create", "update", "receive", "pay"] as const,
  finance: ["read", "create_payment", "apply_advance", "close_cash", "manage_expenses"] as const,
  service_orders: ["read", "create", "update", "consume_part", "deliver", "refund", "create_payment"] as const,
  devices: ["read", "create", "update", "delete"] as const,
  users: ["read", "create", "update", "delete"] as const,
  clients: ["read", "create", "update", "delete"] as const,
  suppliers: ["read", "create", "update", "delete"] as const,
  reports: ["read"] as const,
  audit: ["read"] as const,
  approvals: ["read", "create", "approve", "reject"] as const,
  notifications: ["read", "create", "update"] as const,
} as const;

export type Resource = keyof typeof PERMISSIONS;
export type Action<R extends Resource = Resource> = (typeof PERMISSIONS[R])[number];

const ALL: Record<Resource, readonly string[]> = {
  products: PERMISSIONS.products,
  sales: PERMISSIONS.sales,
  purchases: PERMISSIONS.purchases,
  finance: PERMISSIONS.finance,
  service_orders: PERMISSIONS.service_orders,
  devices: PERMISSIONS.devices,
  users: PERMISSIONS.users,
  clients: PERMISSIONS.clients,
  suppliers: PERMISSIONS.suppliers,
  reports: PERMISSIONS.reports,
  audit: PERMISSIONS.audit,
  approvals: PERMISSIONS.approvals,
  notifications: PERMISSIONS.notifications,
};

const ROLE_POLICY: Record<Role, Partial<Record<Resource, readonly string[]>>> = {
  admin: ALL,
  gerente: {
    products: ["read", "create", "update", "adjust_stock"],
    sales: ["read", "create", "update", "cancel", "refund", "discount"],
    purchases: ["read", "create", "update", "receive", "pay"],
    finance: ["read", "create_payment", "apply_advance", "close_cash", "manage_expenses"],
    service_orders: ["read", "create", "update", "consume_part", "deliver", "refund", "create_payment"],
    devices: ["read", "create", "update", "delete"],
    users: ["read", "update"],
    clients: ["read", "create", "update", "delete"],
    suppliers: ["read", "create", "update", "delete"],
    reports: ["read"],
    audit: ["read"],
    approvals: ["read", "create", "approve", "reject"],
    notifications: ["read", "create", "update"],
  },
  vendedor: {
    products: ["read"], sales: ["read", "create", "update"], purchases: ["read"],
    finance: ["read", "create_payment", "apply_advance"], service_orders: ["read", "create"],
    devices: ["read", "create", "update"], clients: ["read", "create", "update"], suppliers: ["read"], reports: ["read"],
    approvals: ["read", "create"], notifications: ["read", "update"],
  },
  tecnico: {
    products: ["read"], service_orders: ["read", "create", "update", "consume_part"],
    devices: ["read", "create", "update"], clients: ["read"],
    approvals: ["read", "create"], notifications: ["read", "update"],
  },
  cajero: {
    products: ["read"], sales: ["read", "create"], finance: ["read", "create_payment", "apply_advance", "close_cash"],
    service_orders: ["read", "create_payment"], clients: ["read", "create", "update"], reports: ["read"],
    approvals: ["read", "create"], notifications: ["read", "update"],
  },
};

export function normalizeRole(role?: string | null): Role | null {
  const normalized = role?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "administrator" || normalized === "admin") return "admin";
  if (normalized === "manager" || normalized === "gerente") return "gerente";
  if (normalized === "seller" || normalized === "vendedor" || normalized === "retailer" || normalized === "user") return "vendedor";
  if (normalized === "technician" || normalized === "tecnico" || normalized === "técnico") return "tecnico";
  if (normalized === "cashier" || normalized === "cajero") return "cajero";
  return null;
}

export function hasPermission(role: string | null | undefined, resource: Resource, action: string): boolean {
  const normalized = normalizeRole(role);
  if (!normalized || !(resource in PERMISSIONS)) return false;
  return ROLE_POLICY[normalized][resource]?.includes(action) ?? false;
}

export function assertPermission(role: string | null | undefined, resource: Resource, action: string): void {
  if (!hasPermission(role, resource, action)) {
    const error = new Error("FORBIDDEN");
    error.name = "AuthorizationError";
    throw error;
  }
}

export function permissionsForRole(role: string | null | undefined): Record<string, readonly string[]> {
  const normalized = normalizeRole(role);
  if (!normalized) return {};
  return { ...ROLE_POLICY[normalized] };
}
