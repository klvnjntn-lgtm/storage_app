import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildCoretaxXml, code04Amounts, normalizeTin, type CoretaxInvoice } from './coretax-xml';

// Why an invoice can't go into the file and has to be entered by hand.
export type SkipReason = 'NO_BUYER_TIN' | 'UNSUPPORTED_RATE' | 'UNTAXED_LINES';

export type ExportRow = {
  id: string;
  invoiceNumber: string | null;
  date: string;
  customerName: string | null;
  taxBase: number;
  vat: number;
  exportedAt: Date | null;
};

const EXPORT_INCLUDE = {
  customer: { select: { npwp: true, email: true, address: true, billingAddress: true } },
  items: {
    orderBy: { id: 'asc' },
    include: { taxes: { select: { percentage: true } }, product: { select: { name: true } } },
  },
} satisfies Prisma.InvoiceInclude;

type ExportInvoice = Prisma.InvoiceGetPayload<{ include: typeof EXPORT_INCLUDE }>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Coretax e-Faktur export: issued invoices carrying PPN, as the XML that
// Coretax's "Impor Data" for Faktur Keluaran accepts.
@Injectable()
export class TaxExportService {
  constructor(private prisma: PrismaService) {}

  private async load(organizationId: string, from: string, to: string, includeExported: boolean) {
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new BadRequestException('from and to must be YYYY-MM-DD');
    if (from > to) throw new BadRequestException('from must be on or before to');

    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { npwp: true },
    });
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: InvoiceStatus.ISSUED,
        taxAmount: { gt: 0 },
        invoiceDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
        ...(!includeExported && { coretaxExportedAt: null }),
      },
      orderBy: [{ invoiceDate: 'asc' }, { invoiceNumber: 'asc' }],
      include: EXPORT_INCLUDE,
    });
    return { sellerTin: normalizeTin(org.npwp), invoices };
  }

  private classify(inv: ExportInvoice): { reason: SkipReason } | { faktur: CoretaxInvoice } {
    const buyerTin = normalizeTin(inv.customerNpwp ?? inv.customer?.npwp);
    if (!buyerTin) return { reason: 'NO_BUYER_TIN' };

    for (const item of inv.items) {
      const rate = item.taxes.reduce((sum, t) => sum + Number(t.percentage), 0);
      if (rate === 0) return { reason: 'UNTAXED_LINES' };
      if (rate !== 11) return { reason: 'UNSUPPORTED_RATE' };
    }

    return {
      faktur: {
        date: isoDate(inv.invoiceDate ?? inv.issuedAt ?? inv.createdAt),
        reference: inv.invoiceNumber ?? inv.id,
        buyerTin,
        buyerName: inv.customerName ?? '',
        buyerAddress:
          inv.customerBillingAddress ??
          inv.customerAddress ??
          inv.customer?.billingAddress ??
          inv.customer?.address ??
          '',
        buyerEmail: inv.customer?.email ?? '',
        lines: inv.items.map((item) => ({
          isService: !item.productId,
          name: item.productName ?? item.product?.name ?? item.description ?? '',
          unit: item.unit,
          unitPrice: Number(item.unitPrice),
          quantity: Number(item.quantity),
          discount: Number(item.discountAmount),
          taxBase: Number(item.netAmount),
        })),
      },
    };
  }

  async preview(organizationId: string, from: string, to: string, includeExported: boolean) {
    const { sellerTin, invoices } = await this.load(organizationId, from, to, includeExported);
    const ready: ExportRow[] = [];
    const skipped: (ExportRow & { reason: SkipReason })[] = [];
    for (const inv of invoices) {
      const row: ExportRow = {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        date: isoDate(inv.invoiceDate ?? inv.issuedAt ?? inv.createdAt),
        customerName: inv.customerName,
        taxBase: inv.items.reduce((sum, i) => sum + Number(i.netAmount), 0),
        vat: Number(inv.taxAmount),
        exportedAt: inv.coretaxExportedAt,
      };
      const result = this.classify(inv);
      if ('reason' in result) {
        skipped.push({ ...row, reason: result.reason });
      } else {
        // Show what the file will carry, which can differ from the
        // invoice's own PPN by rounding.
        row.vat = result.faktur.lines.reduce((sum, l) => sum + code04Amounts(l.taxBase).vat, 0);
        ready.push(row);
      }
    }
    return { sellerTinValid: !!sellerTin, ready, skipped };
  }

  // Builds the file and stamps every invoice in it, so the next export
  // (without includeExported) picks up only new ones.
  async export(organizationId: string, from: string, to: string, includeExported: boolean) {
    const { sellerTin, invoices } = await this.load(organizationId, from, to, includeExported);
    if (!sellerTin) {
      throw new BadRequestException('Set your 16-digit NPWP in Settings → Business details before exporting');
    }
    const fakturs: CoretaxInvoice[] = [];
    const ids: string[] = [];
    for (const inv of invoices) {
      const result = this.classify(inv);
      if ('faktur' in result) {
        fakturs.push(result.faktur);
        ids.push(inv.id);
      }
    }
    if (fakturs.length === 0) throw new BadRequestException('No invoices in this period can be exported');

    const xml = buildCoretaxXml(sellerTin, fakturs);
    await this.prisma.invoice.updateMany({
      where: { id: { in: ids }, organizationId },
      data: { coretaxExportedAt: new Date() },
    });
    return { xml, count: fakturs.length };
  }
}
