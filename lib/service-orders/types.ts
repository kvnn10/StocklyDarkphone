export const SERVICE_ORDER_STATUSES = [
  "received",
  "diagnosis",
  "awaiting_approval",
  "repairing",
  "ready",
  "delivered",
  "cancelled",
] as const;

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export type ServiceOrderDeviceType =
  | "phone"
  | "tablet"
  | "computer"
  | "watch"
  | "console"
  | "tv"
  | "other";

export interface ServiceOrderDraft {
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  deviceType: ServiceOrderDeviceType;
  brand: string;
  model: string;
  imei?: string;
  serialNumber?: string;
  reportedIssue: string;
  initialCondition?: string;
  accessories?: string[];
  estimatedLabor?: number;
  notes?: string;
}

export interface ServiceOrderTotals {
  labor: number;
  parts: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
}

export interface ServiceOrderPart {
  productId: string;
  productName: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface ServiceOrderSummary extends ServiceOrderDraft {
  id: string;
  orderNumber: string;
  status: ServiceOrderStatus;
  technicianId?: string;
  technicianName?: string;
  diagnosis?: string;
  workPerformed?: string;
  parts: ServiceOrderPart[];
  totals: ServiceOrderTotals;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}
