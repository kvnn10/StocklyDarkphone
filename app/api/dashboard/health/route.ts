import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { reconcileInventory } from "@/lib/stock-allocation/reconcile-inventory";
import { getDashboardForAdmin } from "@/lib/server/dashboard-data";

/**
 * Operational dashboard health: combines the existing dashboard figures with
 * the inventory reconciliation guard so the UI can surface inconsistencies
 * without modifying stock.
 */
export async function GET(request: NextRequest) {
  try {
    const limited = await withRateLimit(request, defaultRateLimits.standard);
    if (limited) return limited;

    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [dashboard, inventory] = await Promise.all([
      getDashboardForAdmin(session.id),
      reconcileInventory(session.id, { repair: false }),
    ]);

    const health = {
      status: inventory.issues.length === 0 ? "healthy" : "attention",
      inventory: {
        checked: inventory.checked,
        healthy: inventory.healthy,
        issues: inventory.issues.length,
        blocked: inventory.blocked,
      },
    };

    return NextResponse.json({
      health,
      dashboard: {
        revenue: dashboard.revenue,
        orderAnalytics: dashboard.orderAnalytics,
        invoiceAnalytics: dashboard.invoiceAnalytics,
        warehouseAnalytics: dashboard.warehouseAnalytics,
        totalInventoryValue: dashboard.totalInventoryValue ?? 0,
        productStatusBreakdown: dashboard.productStatusBreakdown,
      },
    });
  } catch (error) {
    console.error("Dashboard health failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard health" },
      { status: 500 },
    );
  }
}
