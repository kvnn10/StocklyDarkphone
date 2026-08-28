export type ProfitLine = {
  quantity: number;
  price: number;
  purchasePrice?: number | null;
  subtotal?: number | null;
};

export type OrderProfit = {
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPercent: number;
};

/**
 * Calculates gross profit from the purchase-cost snapshot stored on each
 * order line. Never reads the current product cost, so historical profit
 * remains stable after a product's purchasePrice changes.
 */
export function calculateOrderProfit(
  items: readonly ProfitLine[],
  discount = 0,
): OrderProfit {
  const safeDiscount = Number.isFinite(discount) ? Math.max(0, discount) : 0;
  const revenueBeforeDiscount = items.reduce(
    (sum, item) => sum + Math.max(0, Number(item.price) || 0) * Math.max(0, Number(item.quantity) || 0),
    0,
  );
  const revenue = Math.max(0, revenueBeforeDiscount - Math.min(safeDiscount, revenueBeforeDiscount));
  const cost = items.reduce(
    (sum, item) => sum + Math.max(0, Number(item.purchasePrice) || 0) * Math.max(0, Number(item.quantity) || 0),
    0,
  );
  const grossProfit = revenue - cost;
  const marginPercent = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  return { revenue, cost, grossProfit, marginPercent };
}
