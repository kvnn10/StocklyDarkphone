import { prisma } from "@/prisma/client";

export type StripeReconciliationIssue = {
  code:
    | "payment_missing_sale_payment"
    | "payment_missing_cash"
    | "payment_missing_order"
    | "payment_missing_invoice"
    | "payment_amount_mismatch"
    | "order_paid_mismatch"
    | "invoice_paid_mismatch"
    | "refund_missing_cash"
    | "refund_amount_mismatch";
  severity: "error" | "warning";
  message: string;
  paymentIntentId?: string;
  refundId?: string;
  orderId?: string;
  invoiceId?: string;
  expected?: number;
  actual?: number;
};

type LedgerRow = {
  _id?: string;
  kind?: string;
  paymentIntentId?: string;
  refundId?: string | null;
  orderId?: string | null;
  invoiceId?: string | null;
  amount?: number;
  currency?: string;
  status?: string;
};

async function readLedger(filter: Record<string, unknown> = {}): Promise<LedgerRow[]> {
  const result = await prisma.$runCommandRaw({
    find: "StripeLedger",
    filter,
    sort: { createdAt: 1 },
    limit: 5000,
  }) as { cursor?: { firstBatch?: LedgerRow[] } };
  return result.cursor?.firstBatch ?? [];
}

const cents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100);

export async function reconcileStripeLedger(options?: {
  orderId?: string;
  paymentIntentId?: string;
}) {
  const filter: Record<string, unknown> = { status: "applied" };
  if (options?.orderId) filter.orderId = options.orderId;
  if (options?.paymentIntentId) filter.paymentIntentId = options.paymentIntentId;

  const ledger = await readLedger(filter);
  const payments = ledger.filter((entry) => entry.kind === "payment_intent");
  const refunds = ledger.filter((entry) => entry.kind === "refund" && entry.refundId);
  const issues: StripeReconciliationIssue[] = [];

  const orderIds = [...new Set(ledger.map((entry) => entry.orderId).filter(Boolean) as string[])];
  const invoiceIds = [...new Set(ledger.map((entry) => entry.invoiceId).filter(Boolean) as string[])];

  const orders = await prisma.order.findMany({
    where: orderIds.length ? { id: { in: orderIds } } : { id: "__none__" },
    include: { invoice: true },
  });
  const invoices = await prisma.invoice.findMany({
    where: invoiceIds.length ? { id: { in: invoiceIds } } : { id: "__none__" },
  });

  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));

  const relatedOrderIds = [...new Set([
    ...orderIds,
    ...orders.map((order) => order.id),
    ...invoices.map((invoice) => invoice.orderId),
  ])];

  const salePayments = relatedOrderIds.length
    ? await prisma.salePayment.findMany({ where: { orderId: { in: relatedOrderIds }, status: "paid" } })
    : [];
  const cashMovements = relatedOrderIds.length
    ? await prisma.cashMovement.findMany({
        where: {
          orderId: { in: relatedOrderIds },
          status: "active",
          OR: [
            { source: "sale_payment" },
            { source: "refund" },
          ],
        },
      })
    : [];

  for (const payment of payments) {
    const amount = Number(payment.amount ?? 0);
    const order = payment.orderId ? orderMap.get(payment.orderId) : undefined;
    const invoice = payment.invoiceId ? invoiceMap.get(payment.invoiceId) : undefined;

    if (!order && !invoice) {
      issues.push({
        code: "payment_missing_order",
        severity: "error",
        message: "Stripe payment exists in the ledger but its local order/invoice cannot be found.",
        paymentIntentId: payment.paymentIntentId,
        orderId: payment.orderId ?? undefined,
        invoiceId: payment.invoiceId ?? undefined,
      });
      continue;
    }

    const orderId = order?.id ?? invoice?.orderId;
    const localPayments = salePayments.filter((row) => row.orderId === orderId);
    const localPaid = localPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const paymentCash = cashMovements.find(
      (movement) =>
        movement.orderId === orderId &&
        movement.source === "sale_payment" &&
        movement.paymentMethod === "card" &&
        movement.description === `Pago de Stripe ${payment.paymentIntentId}`,
    );

    if (!localPayments.length) {
      issues.push({
        code: "payment_missing_sale_payment",
        severity: "error",
        message: "Stripe payment is applied but no local SalePayment exists for the order.",
        paymentIntentId: payment.paymentIntentId,
        orderId,
        invoiceId: payment.invoiceId ?? undefined,
        expected: amount,
        actual: 0,
      });
    }

    if (!paymentCash) {
      issues.push({
        code: "payment_missing_cash",
        severity: "error",
        message: "Stripe payment is applied but Caja has no matching Stripe cash movement.",
        paymentIntentId: payment.paymentIntentId,
        orderId,
        invoiceId: payment.invoiceId ?? undefined,
        expected: amount,
        actual: 0,
      });
    } else if (cents(paymentCash.amount) !== cents(amount)) {
      issues.push({
        code: "payment_amount_mismatch",
        severity: "error",
        message: "Stripe ledger payment amount differs from its Caja movement.",
        paymentIntentId: payment.paymentIntentId,
        orderId,
        expected: amount,
        actual: paymentCash.amount,
      });
    }

    if (order) {
      const orderTotal = Math.max(0, Number(order.total || 0));
      if (order.paymentStatus === "paid" && cents(localPaid) !== cents(orderTotal)) {
        issues.push({
          code: "order_paid_mismatch",
          severity: "error",
          message: "Order is marked paid but SalePayment totals do not match the order total.",
          paymentIntentId: payment.paymentIntentId,
          orderId: order.id,
          expected: orderTotal,
          actual: localPaid,
        });
      }
    }

    if (invoice) {
      const invoiceTotal = Math.max(0, Number(invoice.total || 0));
      if (invoice.status === "paid" && (cents(invoice.amountDue) !== 0 || cents(invoice.amountPaid) !== cents(invoiceTotal))) {
        issues.push({
          code: "invoice_paid_mismatch",
          severity: "error",
          message: "Invoice is marked paid but amountPaid/amountDue do not match the invoice total.",
          paymentIntentId: payment.paymentIntentId,
          invoiceId: invoice.id,
          orderId: invoice.orderId,
          expected: invoiceTotal,
          actual: invoice.amountPaid,
        });
      }
    }
  }

  for (const refund of refunds) {
    const orderId = refund.orderId ?? undefined;
    const matchingCash = orderId
      ? cashMovements.find(
          (movement) =>
            movement.orderId === orderId &&
            movement.source === "refund" &&
            movement.paymentMethod === "card" &&
            movement.description === `Reembolso de Stripe ${refund.refundId}`,
        )
      : undefined;

    if (!matchingCash) {
      issues.push({
        code: "refund_missing_cash",
        severity: "error",
        message: "Stripe refund exists in the ledger but Caja has no matching refund movement.",
        paymentIntentId: refund.paymentIntentId,
        refundId: refund.refundId ?? undefined,
        orderId,
        invoiceId: refund.invoiceId ?? undefined,
        expected: Number(refund.amount || 0),
        actual: 0,
      });
    } else if (cents(matchingCash.amount) !== cents(Number(refund.amount || 0))) {
      issues.push({
        code: "refund_amount_mismatch",
        severity: "error",
        message: "Stripe refund amount differs from its Caja movement.",
        paymentIntentId: refund.paymentIntentId,
        refundId: refund.refundId ?? undefined,
        orderId,
        expected: Number(refund.amount || 0),
        actual: matchingCash.amount,
      });
    }
  }

  return {
    ok: issues.length === 0,
    checked: { ledgerEntries: ledger.length, payments: payments.length, refunds: refunds.length },
    issues,
  };
}
