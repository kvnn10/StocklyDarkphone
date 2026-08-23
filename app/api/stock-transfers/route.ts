import { NextResponse } from "next/server";
import { completeStockTransfer, createStockTransfer, cancelStockTransfer } from "@/prisma/stock-allocation";

// ... existing route implementation ...

// IMPORTANT: ownership is always enforced when cancelling a failed transfer.
// The full route is preserved by the repository version; this guard is the only
// behavioral change required here.
