import { resolveTimezone, todayBusinessDate } from '../accounting/business-date';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import {
  InvoiceFormat,
  InvoiceStatus,
  MessageChannel,
  ModuleKey,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../auth/mailer/mailer.service';
import { BillingService } from '../billing/billing.service';
import { InvoiceService } from '../invoice/invoice.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DashboardService } from '../dashboard/dashboard.service';
import { MessagingModule } from './messaging.module';
import { MessagingService } from './messaging.service';
import { normalizeWhatsAppNumber } from './whatsapp-provider';
import { messageText } from './message-templates';
import { waPricePerMessage, WA_TOPUP_PACKAGES } from './wa-wallet';

process.env.PRINT_TOKEN_SECRET ??= 'test-print-secret';
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), 'waresys-msg-'));
// Puppeteer is ESM-only; PDFs are stubbed below.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

describe('normalizeWhatsAppNumber', () => {
  it('turns the ways people type Indonesian numbers into international digits', () => {
    expect(normalizeWhatsAppNumber('0812-3456-7890')).toBe('6281234567890');
    expect(normalizeWhatsAppNumber('+62 812 3456 7890')).toBe('6281234567890');
    expect(normalizeWhatsAppNumber('6281234567890')).toBe('6281234567890');
    expect(normalizeWhatsAppNumber('abc')).toBeNull();
    expect(normalizeWhatsAppNumber(null)).toBeNull();
  });
});

describe('message templates', () => {
  it('escapes user-entered names', () => {
    const { html } = messageText('en', 'invoice', {
      business: 'Shop',
      customer: '<script>x</script>',
      number: 'INV-1',
      total: 'Rp 1',
      due: '—',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// Runs against the isolated test DB (see test/setup-test-env.ts).
describe('Messaging (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let messaging: MessagingService;
  let billing: BillingService;
  const sent: { to: string; subject: string; attachments?: unknown[] }[] = [];

  let orgId: string;
  let adminId: string;
  let customerId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [PrismaModule, MessagingModule, DashboardModule],
    })
      .overrideProvider(MailerService)
      .useValue({
        isConfigured: () => true,
        send: async (p: {
          to: string;
          subject: string;
          attachments?: unknown[];
        }) => {
          sent.push(p);
          return {};
        },
      })
      .compile();
    await module.init();
    prisma = module.get(PrismaService);
    messaging = module.get(MessagingService);
    billing = module.get(BillingService);
    jest
      .spyOn(module.get(InvoiceService), 'renderPdf')
      .mockResolvedValue(Buffer.from('%PDF-1.4 test'));

    orgId = (
      await prisma.organization.create({
        data: {
          name: `Messaging ${randomUUID()}`,
          plan: 'trial',
          trialEndsAt: new Date(Date.now() + 864e5),
        },
      })
    ).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({
      data: {
        organizationId: orgId,
        module: ModuleKey.INVOICE_POS,
        enabled: true,
      },
    });
    adminId = (
      await prisma.user.create({
        data: {
          email: `msg-${randomUUID()}@example.com`,
          password: 'x',
          role: 'ADMIN',
          organizationId: orgId,
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: {
          organizationId: orgId,
          name: 'Budi',
          email: 'budi@example.com',
          phone: '0812 1111 2222',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  async function issuedInvoice(dueInDays: number, total = 100_000) {
    return prisma.invoice.create({
      data: {
        organizationId: orgId,
        customerId,
        customerName: 'Budi',
        invoiceNumber: `INV-${randomUUID().slice(0, 6)}`,
        format: InvoiceFormat.A4,
        status: InvoiceStatus.ISSUED,
        issuedAt: new Date(),
        total,
        subtotal: total,
        // Stored like a picked due date: midnight UTC of the business day
        // (a bare now() lands on yesterday before 07:00 WIB).
        dueDate: new Date(todayBusinessDate(resolveTimezone(null)).getTime() + dueInDays * 864e5),
      },
    });
  }

  const balance = async () =>
    Number(
      (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } }))
        .waBalance,
    );

  it('emails an invoice with its PDF to the customer', async () => {
    const inv = await issuedInvoice(14);
    const log = await messaging.sendInvoice(orgId, adminId, inv.id, {
      channel: MessageChannel.EMAIL,
    });
    expect(log.status).toBe('SENT');
    const mail = sent.at(-1)!;
    expect(mail.to).toBe('budi@example.com');
    expect(mail.subject).toContain(inv.invoiceNumber!);
    expect(mail.attachments).toHaveLength(1);
  });

  it('refuses WhatsApp without balance, then charges per message after a top-up', async () => {
    const inv = await issuedInvoice(14);
    await expect(
      messaging.sendInvoice(orgId, adminId, inv.id, {
        channel: MessageChannel.WHATSAPP,
      }),
    ).rejects.toMatchObject({
      response: { error: 'InsufficientWhatsAppBalance' },
    });

    const pkg = WA_TOPUP_PACKAGES[1];
    const topup = await messaging.createTopup(orgId, adminId, pkg.amount);
    await billing.markPaid(topup.id);
    await billing.markPaid(topup.id); // a duplicate webhook credits nothing more
    expect(await balance()).toBe(pkg.credit);

    const log = await messaging.sendInvoice(orgId, adminId, inv.id, {
      channel: MessageChannel.WHATSAPP,
    });
    expect(log).toMatchObject({ status: 'SENT', recipient: '6281211112222' });
    expect(Number(log.cost)).toBe(waPricePerMessage());
    expect(log.attachmentKey).toMatch(/^outbound-docs\//);
    expect(await balance()).toBe(pkg.credit - waPricePerMessage());

    const ledger = await prisma.waLedgerEntry.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledger.map((e) => e.kind)).toEqual(['TOPUP', 'MESSAGE']);
    expect(ledger[1].messageLogId).toBe(log.id);
  });

  it('sends each payment reminder stage once per channel', async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: { reminderEmailEnabled: true, reminderWhatsappEnabled: true },
    });
    const overdue = await issuedInvoice(-7);
    await issuedInvoice(-5); // not on a stage day
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
    });

    await messaging.remindOrg(org);
    await messaging.remindOrg(org);

    const reminders = await prisma.messageLog.findMany({
      where: { organizationId: orgId, kind: 'PAYMENT_REMINDER' },
    });
    expect(reminders.map((r) => r.documentId)).toEqual([
      overdue.id,
      overdue.id,
    ]);
    expect(reminders.map((r) => r.channel).sort()).toEqual([
      'EMAIL',
      'WHATSAPP',
    ]);
  });

  it('summarises the business on the dashboard for admins only', async () => {
    const dashboard = module.get(DashboardService);
    const admin = await dashboard.summary(orgId, {
      sub: adminId,
      role: 'ADMIN',
    });
    expect(admin.finance?.salesToday.count).toBeGreaterThan(0);
    expect(admin.finance?.overdueReceivables.total).toBeGreaterThan(0);
    expect(admin.finance?.salesSeries).toHaveLength(14);
    const staff = await dashboard.summary(orgId, {
      sub: adminId,
      role: 'USER',
    });
    expect(staff.finance).toBeNull();
  });
});
