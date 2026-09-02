import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { financeDb, jsonSafe, oid } from "@/lib/finance/financial-ledger";

const ROLES = ["admin", "user", "retailer"];
const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

function parseDays(value: string | null) {
  if (value === null || value.trim() === "") return DEFAULT_DAYS;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > MAX_DAYS) return null;
  return days;
}

function classify(dueDate: Date | null, now: Date, horizon: Date) {
  if (!dueDate) return "undated";
  if (dueDate.getTime() < now.getTime()) return "overdue";
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  if (dueDate.getTime() <= todayEnd.getTime()) return "today";
  if (dueDate.getTime() <= horizon.getTime()) return "next";
  return "later";
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session || !ROLES.includes(session.role as string)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const days = parseDays(request.nextUrl.searchParams.get("days"));
  if (days === null) {
    return NextResponse.json({ error: `days debe ser un entero entre 0 y ${MAX_DAYS}` }, { status: 400 });
  }

  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + days);
  const db = await financeDb();
  const userId = oid(session.id);

  const [receivables, payables] = await Promise.all([
    db.collection("AccountReceivable").find({ userId, status: { $in: ["open", "partial"] } }).sort({ dueDate: 1 }).limit(500).toArray(),
    db.collection("SupplierAccountPayable").find({ userId, status: { $in: ["open", "partial"] } }).sort({ dueDate: 1 }).limit(500).toArray(),
  ]);

  const mapEntry = (row: any, type: "receivable" | "payable") => {
    const dueDate = row.dueDate ? new Date(row.dueDate) : null;
    const amountDue = Math.max(0, Number(row.amountDue ?? 0));
    return {
      id: row._id?.toHexString?.() ?? String(row._id),
      type,
      reference: row.orderNumber ?? row.reference ?? null,
      partyId: row.clientId?.toHexString?.() ?? row.supplierId?.toHexString?.() ?? null,
      partyName: row.clientName ?? row.supplierName ?? null,
      amountDue,
      dueDate,
      bucket: classify(dueDate, now, horizon),
      daysLate: dueDate && dueDate < now ? Math.max(1, Math.ceil((now.getTime() - dueDate.getTime()) / 86400000)) : 0,
    };
  };

  const entries = [
    ...receivables.map((row: any) => mapEntry(row, "receivable")),
    ...payables.map((row: any) => mapEntry(row, "payable")),
  ];

  const overdue = entries.filter((entry) => entry.bucket === "overdue");
  const today = entries.filter((entry) => entry.bucket === "today");
  const next = entries.filter((entry) => entry.bucket === "next");
  const later = entries.filter((entry) => entry.bucket === "later");
  const sum = (rows: typeof entries) => Math.round((rows.reduce((total, row) => total + row.amountDue, 0) + Number.EPSILON) * 100) / 100;
  const byType = (rows: typeof entries, type: "receivable" | "payable") => rows.filter((row) => row.type === type);

  return NextResponse.json(jsonSafe({
    generatedAt: now,
    days,
    summary: {
      totalOpen: sum(entries),
      overdue: sum(overdue),
      dueToday: sum(today),
      dueSoon: sum(next),
      overdueCount: overdue.length,
      dueTodayCount: today.length,
      dueSoonCount: next.length,
      openCount: entries.length,
    },
    receivables: {
      totalOpen: sum(byType(entries, "receivable")),
      overdue: sum(byType(overdue, "receivable")),
      dueSoon: sum(byType(today, "receivable")) + sum(byType(next, "receivable")),
    },
    payables: {
      totalOpen: sum(byType(entries, "payable")),
      overdue: sum(byType(overdue, "payable")),
      dueSoon: sum(byType(today, "payable")) + sum(byType(next, "payable")),
    },
    alerts: { overdue, today, next, later },
  }));
}
