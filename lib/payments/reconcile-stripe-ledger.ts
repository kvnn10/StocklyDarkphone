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
  createdAt?: Date | string;
};

function isMissingLedgerCollection(error: unknown): boolean {
  const value = error as { code?: number; codeName?: string };
  return value?.code === 26 || value?.codeName === "NamespaceNotFound";
}

async function readLedger(filter: Record<string, unknown> = {}): Promise<LedgerRow[]> {
  try {
    const result = await prisma.$runCommandRaw({
      find: "StripeLedger",
      filter,
      sort: { createdAt: 1 },
      limit: 5000,
    }) as { cursor?: { firstBatch?: LedgerRow[] } };
    return result.cursor?.firstBatch ?? [];
  } catch (error) {
    // A brand-new installation has no ledger collection until the first Stripe payment.
    // Reconciliation must report an empty ledger, not turn the admin dashboard into a 500.
    if (isMissingLedgerCollection(error)) return [];
    throw error;
  }
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

  // Include invoices reached through an order even when the ledger row did not carry invoiceId.
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  for (const order of orders) {
    if (order.invoice) invoiceMap.set(order.invoice.id, order.invoice);
  }
  const orderMap = new Map(orders.map((order) => [order.id, order]));

  const relatedOrderIds = [...new Set([
    ...orderIds,
    ...orders.map((order) => order.id),
    ...invoices.map((invoice) => invoice.orderId),
  ])];

  const [salePayments, cashMovements] = relatedOrderIds.length
    ? await Promise.all([
        prisma.salePayment.findMany({ where: { orderId: { in: relatedOrderIds }, status: "paid" } }),
        prisma.cashMovement.findMany({
          where: {
            orderId: { in: relatedOrderIds },
            status: "active",
            OR: [{ source: "sale_payment" }, { source: "refund" }],
          },
        }),
      ])
    : [[], []];

  const checkedOrderIds = new Set<string>();
  const checkedInvoiceIds = new Set<string>();

  for (const payment of payments) {
    const amount = Number(payment.amount ?? 0);
    const order = payment.orderId ? orderMap.get(payment.orderId) : undefined;
    const invoice = payment.invoiceId
      ? invoiceMap.get(payment.invoiceId)
      : order?.invoice ?? undefined;

    if (!order && !invoice) {
      issues.push({
        code: "payment_missing_order",
        severity: "error",
        message: "El pago de Stripe existe en el ledger, pero no se encuentra su venta/factura local.",
        paymentIntentId: payment.paymentIntentId,
        orderId: payment.orderId ?? undefined,
        invoiceId: payment.invoiceId ?? undefined,
      });
      continue;
    }

    const orderId = order?.id ?? invoice?.orderId;
    if (orderId) {
      checkedOrderIds.add(orderId);
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
          message: "El pago de Stripe está aplicado, pero no existe SalePayment local para la venta.",
          paymentIntentId: payment.paymentIntentId,
          orderId,
          invoiceId: invoice?.id,
          expected: amount,
          actual: 0,
        });
      }

      if (!paymentCash) {
        issues.push({
          code: "payment_missing_cash",
          severity: "error",
          message: "El pago de Stripe está aplicado, pero Caja no tiene su movimiento asociado.",
          paymentIntentId: payment.paymentIntentId,
          orderId,
          invoiceId: invoice?.id,
          expected: amount,
          actual: 0,
        });
      } else if (cents(paymentCash.amount) !== cents(amount)) {
        issues.push({
          code: "payment_amount_mismatch",
          severity: "error",
          message: "El valor del pago de Stripe no coincide con Caja.",
          paymentIntentId: payment.paymentIntentId,
          orderId,
          expected: amount,
          actual: paymentCash.amount,
        });
      }

      const orderTotal = Math.max(0, Number(order?.total || 0));
      if (order?.paymentStatus === "paid" && cents(localPaid) !== cents(orderTotal)) {
        issues.push({
          code: "order_paid_mismatch",
          severity: "error",
          message: "La venta aparece pagada, pero sus pagos locales no cubren exactamente el total.",
          paymentIntentId: payment.paymentIntentId,
          orderId,
          expected: orderTotal,
          actual: localPaid,
        });
      }
    }

    if (invoice) {
      checkedInvoiceIds.add(invoice.id);
      const invoiceTotal = Math.max(0, Number(invoice.total || 0));
      if (invoice.status === "paid" && (cents(invoice.amountDue) !== 0 || cents(invoice.amountPaid) !== cents(invoiceTotal))) {
        issues.push({
          code: "invoice_paid_mismatch",
          severity: "error",
          message: "La factura aparece pagada, pero amountPaid/amountDue no coincide con su total.",
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
    const invoice = refund.invoiceId ? invoiceMap.get(refund.invoiceId) : undefined;
    if (invoice) checkedInvoiceIds.add(invoice.id);
    if (orderId) checkedOrderIds.add(orderId);

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
        message: "El reembolso de Stripe existe en el ledger, pero Caja no tiene su movimiento asociado.",
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
        message: "El valor del reembolso de Stripe no coincide con Caja.",
        paymentIntentId: refund.paymentIntentId,
        refundId: refund.refundId ?? undefined,
        orderId,
        invoiceId: refund.invoiceId ?? undefined,
        expected: Number(refund.amount || 0),
        actual: matchingCash.amount,
      });
    }
  }

  const byCode = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.code] = (acc[issue.code] ?? 0) + 1;
    return acc;
  }, {});

  return {
    ok: issues.length === 0,
    checked: {
      ledgerEntries: ledger.length,
      payments: payments.length,
      refunds: refunds.length,
      orders: checkedOrderIds.size,
      invoices: checkedInvoiceIds.size,
    },
    issueCount: issues.length,
    byCode,
    issues,
  };
}
