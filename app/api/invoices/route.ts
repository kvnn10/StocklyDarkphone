/**
 * Invoices API Route Handler
 * Handles invoice CRUD operations
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { logger } from "@/lib/logger";
import { createInvoice, getInvoicesByUser, getInvoicesByClientId } from "@/prisma/invoice";
import { createInvoiceSchema } from "@/lib/validations";
import { createAuditLog } from "@/prisma/audit-log";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { prisma } from "@/prisma/client";
import { fetchOrderUserIdMap } from "@/lib/invoices/enrich-order-user-ids";
import { attachInvoiceListOrderPreview, fetchInvoiceListOrderPreviewMap } from "@/lib/invoices/enrich-invoice-list-orders";
import { getInvoicesForSupplierId } from "@/lib/server/invoices-data";
import { getSupplierByUserId } from "@/prisma/supplier";
import { cacheKeys, getCache, scheduleInvalidateInvoiceCaches, setCache } from "@/lib/cache";
import { updateOrder, cancelOrder } from "@/prisma/order-lifecycle";
import type { CreateInvoiceInput, InvoiceFilters } from "@/types";

export async function GET(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.id;
    const isClient = session.role === "client";
    const isSupplier = session.role === "supplier";
    const supplier = isSupplier ? await getSupplierByUserId(session.id) : null;
    const { searchParams } = new URL(request.url);
    const filters: InvoiceFilters = {
      searchTerm: searchParams.get("searchTerm") || undefined,
      status: searchParams.getAll("status").length > 0 ? (searchParams.getAll("status") as InvoiceFilters["status"]) : undefined,
      orderId: searchParams.get("orderId") || undefined,
      clientId: searchParams.get("clientId") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      dueDateStart: searchParams.get("dueDateStart") || undefined,
      dueDateEnd: searchParams.get("dueDateEnd") || undefined,
    };
    if (isSupplier) {
      if (!supplier) return NextResponse.json([]);
      return NextResponse.json(await getInvoicesForSupplierId(supplier.id, filters));
    }
    const cacheKey = cacheKeys.invoices.list({ ...(filters as Record<string, unknown>), ...(isClient ? { byClient: true, userId } : { userId, scope: "issuer" }) });
    const cacheReadStartedAt = Date.now();
    const cachedInvoices = await getCache(cacheKey);
    if (cachedInvoices) return NextResponse.json(cachedInvoices);
    const invoices = isClient ? await getInvoicesByClientId(userId, filters) : await getInvoicesByUser(userId, filters);
    let issuerMap = new Map<string, { name: string | null; email: string }>();
    if (isClient && invoices.length > 0) {
      const orderIds = [...new Set(invoices.map((inv) => inv.orderId))];
      const orders = await prisma.order.findMany({ where: { id: { in: orderIds } }, include: { items: { include: { product: { select: { userId: true } } } } } });
      const invoiceIssuerIdMap = new Map<string, string>();
      for (const order of orders) {
        const ownerIds = [...new Set(order.items.map((item) => (item as { product?: { userId?: string } }).product?.userId).filter(Boolean))] as string[];
        if (ownerIds.length > 0 && ownerIds[0]) for (const inv of invoices) if (inv.orderId === order.id) invoiceIssuerIdMap.set(inv.id, ownerIds[0]);
      }
      for (const inv of invoices) if (!invoiceIssuerIdMap.has(inv.id)) invoiceIssuerIdMap.set(inv.id, inv.createdBy ?? inv.userId);
      const users = await prisma.user.findMany({ where: { id: { in: [...new Set(Array.from(invoiceIssuerIdMap.values()))] } }, select: { id: true, name: true, email: true } });
      const userMap = new Map(users.map((u) => [u.id, u]));
      for (const [invId, issuerId] of invoiceIssuerIdMap) { const u = userMap.get(issuerId); if (u) issuerMap.set(invId, { name: u.name, email: u.email }); }
    }
    let clientMap = new Map<string, { name: string | null; email: string }>();
    let orderUserIdMap = new Map<string, string>();
    if (!isClient && invoices.length > 0) {
      const clientIds = [...new Set(invoices.map((inv) => inv.clientId).filter(Boolean))] as string[];
      if (clientIds.length > 0) {
        const clients = await prisma.user.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true, email: true } });
        clientMap = new Map(clients.map((c) => [c.id, { name: c.name, email: c.email }]));
      }
      orderUserIdMap = await fetchOrderUserIdMap(invoices.map((inv) => inv.orderId));
    }
    const orderPreviewMap = await fetchInvoiceListOrderPreviewMap(invoices.map((inv) => inv.orderId));
    const transformedInvoices = invoices.map((invoice) => {
      const issuer = isClient ? issuerMap.get(invoice.id) : undefined;
      const clientInfo = !isClient && invoice.clientId ? clientMap.get(invoice.clientId) : undefined;
      return attachInvoiceListOrderPreview({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, orderId: invoice.orderId, userId: invoice.userId, clientId: invoice.clientId, status: invoice.status, subtotal: invoice.subtotal, tax: invoice.tax, shipping: invoice.shipping ?? null, discount: invoice.discount, total: invoice.total, amountPaid: invoice.amountPaid, amountDue: invoice.amountDue, dueDate: invoice.dueDate.toISOString(), issuedAt: invoice.issuedAt.toISOString(), sentAt: invoice.sentAt?.toISOString() || null, paidAt: invoice.paidAt?.toISOString() || null, cancelledAt: invoice.cancelledAt?.toISOString() || null, paymentLink: invoice.paymentLink, notes: invoice.notes, billingAddress: invoice.billingAddress, createdAt: invoice.createdAt.toISOString(), updatedAt: invoice.updatedAt?.toISOString() || null, createdBy: invoice.createdBy, updatedBy: invoice.updatedBy, ...(issuer ? { issuedByName: issuer.name ?? issuer.email, issuedByEmail: issuer.email } : {}), ...(clientInfo ? { clientName: clientInfo.name ?? clientInfo.email, clientEmail: clientInfo.email } : {}), ...(!isClient ? { orderUserId: orderUserIdMap.get(invoice.orderId) ?? null } : {}) }, orderPreviewMap);
    });
    await setCache(cacheKey, transformedInvoices, 300, { fetchedAt: cacheReadStartedAt });
    return NextResponse.json(transformedInvoices);
  } catch (error) {
    logger.error("Error fetching invoices:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch invoices" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.standard);
    if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role === "supplier" || session.role === "client") return NextResponse.json({ error: "Forbidden: cannot create invoices for this role" }, { status: 403 });
    const userId = session.id;
    const body = await request.json();
    const validationResult = createInvoiceSchema.safeParse(body);
    if (!validationResult.success) return NextResponse.json({ error: "Invalid request body", details: validationResult.error.errors }, { status: 400 });
    const newInvoiceData: CreateInvoiceInput = validationResult.data;

    // Security: an issuer may only create invoices for orders owned by that issuer.
    const order = await prisma.order.findUnique({ where: { id: newInvoiceData.orderId }, select: { id: true, userId: true, status: true } });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.userId !== userId) return NextResponse.json({ error: "Forbidden: order does not belong to current user" }, { status: 403 });

    // Never fulfill stock twice. The database also enforces one invoice per order.
    const existingInvoice = await prisma.invoice.findUnique({ where: { orderId: newInvoiceData.orderId }, select: { id: true, invoiceNumber: true } });
    if (existingInvoice) return NextResponse.json({ error: `Invoice already exists for this order: ${existingInvoice.invoiceNumber}` }, { status: 409 });

    // A pending order is only a reservation. Creating its invoice is the point
    // where the sale is confirmed and the reserved stock is actually consumed.
    const wasPending = order.status === "pending";
    if (wasPending) {
      await updateOrder(newInvoiceData.orderId, { status: "confirmed" }, userId);
    }

    let invoice;
    try {
      invoice = await createInvoice(newInvoiceData, userId);
    } catch (invoiceError) {
      // If inventory was fulfilled but invoice creation failed, restore the order
      // so the stock/reservations return to their previous consistent state.
      if (wasPending) {
        try { await cancelOrder(newInvoiceData.orderId, userId); } catch (rollbackError) { logger.error("Failed to rollback order after invoice creation failure", rollbackError); }
      }
      throw invoiceError;
    }

    createAuditLog({ userId, action: "create", entityType: "invoice", entityId: invoice.id, details: { invoiceNumber: invoice.invoiceNumber } }).catch(() => {});
    await scheduleInvalidateInvoiceCaches();
    const orderPreviewMap = await fetchInvoiceListOrderPreviewMap([invoice.orderId]);
    const orderUserIdMap = await fetchOrderUserIdMap([invoice.orderId]);
    let clientName: string | null = null;
    let clientEmail: string | null = null;
    if (invoice.clientId) {
      const client = await prisma.user.findUnique({ where: { id: invoice.clientId }, select: { name: true, email: true } });
      clientName = client?.name ?? client?.email ?? null;
      clientEmail = client?.email ?? null;
    }
    const transformedInvoice = attachInvoiceListOrderPreview({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, orderId: invoice.orderId, userId: invoice.userId, clientId: invoice.clientId, status: invoice.status, subtotal: invoice.subtotal, tax: invoice.tax, shipping: invoice.shipping ?? null, discount: invoice.discount, total: invoice.total, amountPaid: invoice.amountPaid, amountDue: invoice.amountDue, dueDate: invoice.dueDate.toISOString(), issuedAt: invoice.issuedAt.toISOString(), sentAt: invoice.sentAt?.toISOString() || null, paidAt: invoice.paidAt?.toISOString() || null, cancelledAt: invoice.cancelledAt?.toISOString() || null, paymentLink: invoice.paymentLink, notes: invoice.notes, billingAddress: invoice.billingAddress, createdAt: invoice.createdAt.toISOString(), updatedAt: invoice.updatedAt?.toISOString() || null, createdBy: invoice.createdBy, updatedBy: invoice.updatedBy, clientName, clientEmail, orderUserId: orderUserIdMap.get(invoice.orderId) ?? null }, orderPreviewMap);
    logger.info("Invoice created successfully", { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, orderId: invoice.orderId, userId });
    return NextResponse.json(transformedInvoice, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invoice already exists")) return NextResponse.json({ error: error.message }, { status: 409 });
    logger.error("Error creating invoice:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create invoice" }, { status: 500 });
  }
}
