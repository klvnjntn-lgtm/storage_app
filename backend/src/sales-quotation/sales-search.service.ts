// sales-search.service.ts
//
// Standalone service — doesn't touch SalesQuotationService/SalesOrderService/
// InvoiceService/DeliveryOrderService, just reads the four tables directly
// for a lightweight cross-document search. Register alongside whichever
// module already provides PrismaService for the Sales area (likely your
// existing SalesModule) — I don't have that module file, so wire this in
// there rather than duplicating a new one.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Per-type fetch cap before merging/sorting/paginating — bounded so the
// query stays cheap, generous enough that real pagination (not just a
// top-10 snapshot) actually has enough rows to paginate through. Not the
// same thing as the page `limit` the client asks for.
const FETCH_CAP_PER_TYPE = 200;

export type SalesSearchResultType = 'QUOTATION' | 'ORDER' | 'INVOICE' | 'DELIVERY_ORDER';

export type SalesSearchResult = {
  id: string;
  type: SalesSearchResultType;
  number: string | null;
  customerName: string | null;
  status: string;
  total: string | null; // null for delivery orders — DeliveryOrder carries no pricing
  createdAt: string;
};

// Same page envelope shape as /vehicles/:id/history's HistoryPage on the
// frontend — { items, page, limit, total, totalPages } — so the search
// page can reuse the exact same Previous/Next pagination UI.
export type SalesSearchPage = {
  items: SalesSearchResult[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

@Injectable()
export class SalesSearchService {
  constructor(private prisma: PrismaService) {}

  // Matches document number OR customer name (both the linked Customer's
  // name and the free-text customerName snapshot fallback, same
  // convention used across Invoice/SalesOrder/SalesQuotation/DeliveryOrder).
  // Each table is queried independently (not a UNION) since they don't
  // share a table — merged, optionally filtered by `type`, re-sorted by
  // date, then paginated the same way /vehicles/:id/history is: page +
  // limit in, { items, page, limit, total, totalPages } out.
  async search(
    organizationId: string,
    rawQuery: string,
    page = 1,
    limit = 20,
    type?: SalesSearchResultType,
  ): Promise<SalesSearchPage> {
    const q = rawQuery.trim();
    if (q.length === 0) {
      return { items: [], page, limit, total: 0, totalPages: 0 };
    }

    const [quotations, orders, invoices, deliveryOrders] = await this.prisma.$transaction([
      this.prisma.salesQuotation.findMany({
        where: {
          organizationId,
          OR: [
            { quotationNumber: { contains: q, mode: 'insensitive' } },
            { customerName: { contains: q, mode: 'insensitive' } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          quotationNumber: true,
          customerName: true,
          status: true,
          total: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
        take: FETCH_CAP_PER_TYPE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.salesOrder.findMany({
        where: {
          organizationId,
          OR: [
            { orderNumber: { contains: q, mode: 'insensitive' } },
            { customerName: { contains: q, mode: 'insensitive' } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          orderNumber: true,
          customerName: true,
          status: true,
          total: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
        take: FETCH_CAP_PER_TYPE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          OR: [
            { invoiceNumber: { contains: q, mode: 'insensitive' } },
            { customerName: { contains: q, mode: 'insensitive' } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          invoiceNumber: true,
          customerName: true,
          status: true,
          total: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
        take: FETCH_CAP_PER_TYPE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.deliveryOrder.findMany({
        where: {
          organizationId,
          OR: [
            { doNumber: { contains: q, mode: 'insensitive' } },
            { customerName: { contains: q, mode: 'insensitive' } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
        select: {
          id: true,
          doNumber: true,
          customerName: true,
          status: true,
          createdAt: true,
          customer: { select: { name: true } },
        },
        take: FETCH_CAP_PER_TYPE,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    let merged: SalesSearchResult[] = [
      ...quotations.map((r) => ({
        id: r.id,
        type: 'QUOTATION' as const,
        number: r.quotationNumber,
        customerName: r.customer?.name ?? r.customerName,
        status: r.status,
        total: String(r.total),
        createdAt: r.createdAt.toISOString(),
      })),
      ...orders.map((r) => ({
        id: r.id,
        type: 'ORDER' as const,
        number: r.orderNumber,
        customerName: r.customer?.name ?? r.customerName,
        status: r.status,
        total: String(r.total),
        createdAt: r.createdAt.toISOString(),
      })),
      ...invoices.map((r) => ({
        id: r.id,
        type: 'INVOICE' as const,
        number: r.invoiceNumber,
        customerName: r.customer?.name ?? r.customerName,
        status: r.status,
        total: String(r.total),
        createdAt: r.createdAt.toISOString(),
      })),
      ...deliveryOrders.map((r) => ({
        id: r.id,
        type: 'DELIVERY_ORDER' as const,
        number: r.doNumber,
        customerName: r.customer?.name ?? r.customerName,
        status: r.status,
        total: null,
        createdAt: r.createdAt.toISOString(),
      })),
    ];

    // Optional type filter — applied before pagination so "page 2 of
    // invoices" is actually page 2 of invoices, not page 2 of a mixed
    // set that happens to have some invoices in it.
    if (type) {
      merged = merged.filter((r) => r.type === type);
    }

    // Newest-first across whatever's left, then sliced into the
    // requested page — same merged-then-paginate approach as the rest
    // of this service, just now producing a real page instead of a
    // fixed top-N snapshot.
    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = merged.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const items = merged.slice(start, start + limit);

    return { items, page, limit, total, totalPages };
  }
}