import { SERVICE_ORDER_STATUSES, type ServiceOrderStatus } from "./types";

const transitions: Record<ServiceOrderStatus, readonly ServiceOrderStatus[]> = {
  received: ["diagnosis", "cancelled"],
  diagnosis: ["awaiting_approval", "repairing", "cancelled"],
  awaiting_approval: ["repairing", "cancelled"],
  repairing: ["ready", "cancelled"],
  ready: ["delivered", "repairing"],
  delivered: [],
  cancelled: [],
};

export function canTransitionServiceOrder(
  from: ServiceOrderStatus,
  to: ServiceOrderStatus,
): boolean {
  return transitions[from].includes(to);
}

export function assertServiceOrderTransition(
  from: ServiceOrderStatus,
  to: ServiceOrderStatus,
): void {
  if (!SERVICE_ORDER_STATUSES.includes(to)) {
    throw new Error(`Invalid service order status: ${to}`);
  }

  if (!canTransitionServiceOrder(from, to)) {
    throw new Error(`Invalid service order transition: ${from} -> ${to}`);
  }
}
