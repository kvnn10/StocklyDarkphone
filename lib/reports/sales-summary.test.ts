import { describe, expect, it } from "vitest";
import { summarizeSales } from "@/components/reports/ReportsDashboard";

describe("sales reports", () => {
  it("summarizes the monthly sales trend", () => {
    const stats = { trends: [
      { label: "Jul 26", revenue: 100000, orders: 2, products: 0, invoices: 0 },
      { label: "Aug 26", revenue: 250000, orders: 5, products: 0, invoices: 0 },
    ] } as never;

    expect(summarizeSales(stats)).toEqual({ revenue: 350000, orders: 7, months: 2 });
  });
});
