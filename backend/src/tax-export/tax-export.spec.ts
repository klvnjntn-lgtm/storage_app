import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { TaxExportModule } from './tax-export.module';
import { TaxExportService } from './tax-export.service';
import { buildCoretaxXml, code04Amounts, coretaxUnit, normalizeTin } from './coretax-xml';

describe('Coretax XML', () => {
  it('normalizes NPWP to 16 digits', () => {
    expect(normalizeTin('01.234.567.8-901.000')).toBe('0012345678901000');
    expect(normalizeTin('3171 0123 4567 8901')).toBe('3171012345678901');
    expect(normalizeTin('123')).toBeNull();
    expect(normalizeTin(null)).toBeNull();
  });

  it('maps units, falling back to Lainnya, and labour to Kegiatan', () => {
    expect(coretaxUnit('PCS', false)).toBe('UM.0021');
    expect(coretaxUnit('Liter', false)).toBe('UM.0007');
    expect(coretaxUnit('jerigen', false)).toBe('UM.0033');
    expect(coretaxUnit(null, false)).toBe('UM.0033');
    expect(coretaxUnit('pcs', true)).toBe('UM.0030');
  });

  it('files 11% PPN as code 04: 11/12 of DPP at 12%', () => {
    expect(code04Amounts(1_200_000)).toEqual({ otherTaxBase: 1_100_000, vatRate: 12, vat: 132_000 });
    // Same PPN as 11% of DPP.
    expect(code04Amounts(1_200_000).vat).toBe(1_200_000 * 0.11);
  });

  it('writes the DJP element order and escapes text', () => {
    const xml = buildCoretaxXml('0012345678901000', [
      {
        date: '2026-10-01',
        reference: 'INV-2026-00001',
        buyerTin: '3171012345678901',
        buyerName: 'PT Maju & Jaya <Tbk>',
        buyerAddress: 'Jl. Sudirman 1',
        buyerEmail: '',
        lines: [
          { isService: false, name: 'Oli', unit: 'liter', unitPrice: 100_000, quantity: 4, discount: 0, taxBase: 400_000 },
          { isService: true, name: 'Jasa servis', unit: null, unitPrice: 50_000, quantity: 1, discount: 0, taxBase: 50_000 },
        ],
      },
    ]);
    expect(xml).toContain('<TIN>0012345678901000</TIN>');
    expect(xml).toContain('<TrxCode>04</TrxCode>');
    expect(xml).toContain('<SellerIDTKU>0012345678901000000000</SellerIDTKU>');
    expect(xml).toContain('<BuyerIDTKU>3171012345678901000000</BuyerIDTKU>');
    expect(xml).toContain('<BuyerName>PT Maju &amp; Jaya &lt;Tbk&gt;</BuyerName>');
    expect(xml).toContain('<BuyerAdress>Jl. Sudirman 1</BuyerAdress>');
    expect(xml).toContain('<BuyerEmail/>');
    expect(xml).toContain('<Opt>B</Opt>');
    expect(xml).toContain('<OtherTaxBase>366666.67</OtherTaxBase>');
    expect(xml).toContain('<VAT>44000</VAT>');

    const order = ['TaxInvoiceDate', 'TaxInvoiceOpt', 'TrxCode', 'AddInfo', 'CustomDoc', 'CustomDocMonthYear', 'RefDesc',
      'FacilityStamp', 'SellerIDTKU', 'BuyerTin', 'BuyerDocument', 'BuyerCountry', 'BuyerDocumentNumber', 'BuyerName',
      'BuyerAdress', 'BuyerEmail', 'BuyerIDTKU', 'ListOfGoodService', 'Opt', 'Code', 'Name', 'Unit', 'Price', 'Qty',
      'TotalDiscount', 'TaxBase', 'OtherTaxBase', 'VATRate', 'VAT', 'STLGRate', 'STLG'];
    const positions = order.map((tag) => xml.indexOf(`<${tag}`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

// Picking and stamping invoices, against the isolated test DB.
describe('Coretax export', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let service: TaxExportService;
  let orgId: string;
  let withTin: string;
  let withoutTin: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, TaxExportModule] }).compile();
    prisma = module.get(PrismaService);
    service = module.get(TaxExportService);
    orgId = (await prisma.organization.create({ data: { name: `Tax ${randomUUID()}`, npwp: '01.234.567.8-901.000' } })).id;
    withTin = (await prisma.customer.create({ data: { name: 'PT Buyer', organizationId: orgId, npwp: '3171012345678901' } })).id;
    withoutTin = (await prisma.customer.create({ data: { name: 'Walk-in', organizationId: orgId } })).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  async function invoice(customerId: string, rates: number[], opts: { date?: string; status?: InvoiceStatus } = {}) {
    const net = 100_000;
    const tax = rates.reduce((s, r) => s + (net * r) / 100, 0);
    return prisma.invoice.create({
      data: {
        organizationId: orgId,
        invoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
        format: 'A4',
        status: opts.status ?? InvoiceStatus.ISSUED,
        customerId,
        customerName: 'Buyer',
        invoiceDate: new Date(`${opts.date ?? '2026-10-10'}T00:00:00Z`),
        subtotal: net * rates.length || net,
        taxAmount: tax,
        total: net * rates.length + tax,
        items: {
          create: (rates.length ? rates : [0]).map((r) => ({
            description: 'Jasa',
            quantity: 1,
            unitPrice: net,
            lineTotal: net,
            netAmount: net,
            taxAmount: (net * r) / 100,
            total: net + (net * r) / 100,
            taxes: r ? { create: [{ name: 'PPN', percentage: r, amount: (net * r) / 100 }] } : undefined,
          })),
        },
      },
    });
  }

  it('exports 11% invoices once, and lists the rest with a reason', async () => {
    const good = await invoice(withTin, [11]);
    const noTin = await invoice(withoutTin, [11]);
    const odd = await invoice(withTin, [12]);
    const mixed = await invoice(withTin, [11, 0]);
    await invoice(withTin, [11], { date: '2026-09-30' }); // outside the period
    await invoice(withTin, [11], { status: InvoiceStatus.VOID });

    const preview = await service.preview(orgId, '2026-10-01', '2026-10-31', false);
    expect(preview.sellerTinValid).toBe(true);
    expect(preview.ready.map((r) => r.id)).toEqual([good.id]);
    expect(preview.ready[0].vat).toBe(11_000);
    expect(Object.fromEntries(preview.skipped.map((s) => [s.id, s.reason]))).toEqual({
      [noTin.id]: 'NO_BUYER_TIN',
      [odd.id]: 'UNSUPPORTED_RATE',
      [mixed.id]: 'UNTAXED_LINES',
    });

    const { xml, count } = await service.export(orgId, '2026-10-01', '2026-10-31', false);
    expect(count).toBe(1);
    expect(xml).toContain(`<RefDesc>${good.invoiceNumber}</RefDesc>`);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: good.id } })).coretaxExportedAt).not.toBeNull();

    // Already exported: gone unless asked for.
    await expect(service.export(orgId, '2026-10-01', '2026-10-31', false)).rejects.toThrow(BadRequestException);
    expect((await service.export(orgId, '2026-10-01', '2026-10-31', true)).count).toBe(1);
  });

  it('refuses to export without a valid seller NPWP', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { npwp: '' } });
    try {
      await invoice(withTin, [11], { date: '2026-11-05' });
      await expect(service.export(orgId, '2026-11-01', '2026-11-30', false)).rejects.toThrow('NPWP');
    } finally {
      await prisma.organization.update({ where: { id: orgId }, data: { npwp: '01.234.567.8-901.000' } });
    }
  });
});
