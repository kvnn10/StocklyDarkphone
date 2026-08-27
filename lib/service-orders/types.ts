export const SERVICE_ORDER_STATUSES = [
  "received",
  "diagnosis",
  "awaiting_approval",
  "approved",
  "in_repair",
  "ready",
  "delivered",
  "cancelled",
] as const;

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export type ServiceOrderSummary = {
  id: string;
  customerId: string;
  deviceType: string;
  brand?: string;
  model?: string;
  serialOrImei?: string;
  problem: string;
  diagnosis?: string;
  status: ServiceOrderStatus;
  laborAmount: number;
  partsAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  createdAt: string;
};

export function calculateServiceTotal(input: {
  laborAmount?: number;
  partsAmount?: number;
  discount?: number;
}) {
  const labor = Math.max(0, Number(input.laborAmount ?? 0));
  const parts = Math.max(0, Number(input.partsAmount ?? 0));
  const discount = Math.min(labor + parts, Math.max(0, Number(input.discount ?? 0)));
  return labor + parts - discount;
}
