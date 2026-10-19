import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BillingPurpose,
  InvoiceStatus,
  MessageChannel,
  MessageKind,
  MessageStatus,
  ModuleKey,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../auth/mailer/mailer.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BillingService } from '../billing/billing.service';
import { InvoiceService } from '../invoice/invoice.service';
import { PurchaseOrderService } from '../purchase-order/purchase-order.service';
import {
  FILE_STORAGE,
  type FileStorage,
} from '../storage/file-storage.interface';
import { SignedFileUrlService } from '../storage/signed-file-url.service';
import {
  resolveTimezone,
  todayBusinessDate,
} from '../accounting/business-date';
import {
  createWhatsAppProvider,
  normalizeWhatsAppNumber,
  WhatsAppProvider,
} from './whatsapp-provider';
import {
  chargeWaMessage,
  creditWaTopup,
  refundWaMessage,
  waPricePerMessage,
  WA_TOPUP_PACKAGES,
} from './wa-wallet';
import {
  messageText,
  MessageLanguage,
  money,
  shortDate,
} from './message-templates';
import { CRON_TIMEZONE } from '../common/cron-timezone';

const DAY = 86_400_000;
// WhatsApp document links stay valid this long; the PDF is deleted after.
const ATTACHMENT_TTL_SECONDS = 7 * 24 * 60 * 60;
// Automatic reminders: days relative to the due date (negative = before).
export const REMINDER_STAGES = [-3, 1, 7, 14, 30];
// Admins are warned when the balance can't cover this many more messages.
const LOW_BALANCE_MESSAGES = 20;

export type SendOptions = {
  channel: MessageChannel;
  to?: string;
  message?: string;
};

type Outgoing = {
  organizationId: string;
  userId: string | null;
  channel: MessageChannel;
  kind: MessageKind;
  documentId: string | null;
  recipient: string;
  reminderKey?: string;
  email?: {
    subject: string;
    html: string;
    text: string;
    attachment?: { filename: string; content: Buffer };
  };
  whatsapp?: {
    template: string;
    params: string[];
    pdf?: { filename: string; content: Buffer };
  };
};

// Sends business documents (invoices, purchase orders, statements) and
// payment reminders by email or WhatsApp, and keeps the prepaid WhatsApp
// balance that pays for the latter.
//
// WhatsApp costs money per message, so a message is charged before it is
// sent and refunded if the provider refuses it; a business with no balance
// simply can't send until it tops up. Email is free.
@Injectable()
export class MessagingService implements OnModuleInit {
  private readonly logger = new Logger(MessagingService.name);
  private readonly whatsapp: WhatsAppProvider | null = createWhatsAppProvider();

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private notifications: NotificationsService,
    private billing: BillingService,
    private invoices: InvoiceService,
    private purchaseOrders: PurchaseOrderService,
    private signer: SignedFileUrlService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
  ) {}

  onModuleInit() {
    // A paid top-up lands here, inside billing's settlement transaction.
    this.billing.registerApplier(
      BillingPurpose.WA_TOPUP,
      async (tx, payment) => {
        await creditWaTopup(
          tx,
          payment.organizationId,
          Number(payment.credit ?? payment.amount),
          payment.id,
        );
      },
    );
  }

  private language(): MessageLanguage {
    return process.env.MESSAGE_LANGUAGE === 'en' ? 'en' : 'id';
  }

  // ---- WhatsApp balance ------------------------------------------------

  channels() {
    return {
      email: this.mailer.isConfigured(),
      whatsapp: !!this.whatsapp && !!this.billing.gatewayName(),
    };
  }

  async whatsappOverview(organizationId: string) {
    const [org, ledger, messages, topups] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: {
          waBalance: true,
          reminderEmailEnabled: true,
          reminderWhatsappEnabled: true,
        },
      }),
      this.prisma.waLedgerEntry.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.messageLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.billingPayment.findMany({
        where: { organizationId, purpose: BillingPurpose.WA_TOPUP },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      balance: Number(org.waBalance),
      pricePerMessage: waPricePerMessage(),
      provider: this.whatsapp?.name ?? null,
      emailConfigured: this.mailer.isConfigured(),
      gateway: this.billing.gatewayName(),
      packages: WA_TOPUP_PACKAGES,
      settings: {
        reminderEmailEnabled: org.reminderEmailEnabled,
        reminderWhatsappEnabled: org.reminderWhatsappEnabled,
      },
      reminderStages: REMINDER_STAGES,
      ledger,
      messages,
      topups,
    };
  }

  async createTopup(organizationId: string, userId: string, amount: number) {
    const pkg = WA_TOPUP_PACKAGES.find((p) => p.amount === amount);
    if (!pkg)
      throw new BadRequestException('Choose one of the top-up packages');
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });
    return this.billing.createCheckout(organizationId, userId, {
      purpose: BillingPurpose.WA_TOPUP,
      amount: pkg.amount,
      credit: pkg.credit,
      description: `WareSys WhatsApp balance top-up (${org.name})`,
      returnPath: '/settings/whatsapp',
    });
  }

  async updateSettings(
    organizationId: string,
    dto: { reminderEmailEnabled?: boolean; reminderWhatsappEnabled?: boolean },
  ) {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: dto,
    });
    return (await this.whatsappOverview(organizationId)).settings;
  }

  // ---- documents -------------------------------------------------------

  async sendInvoice(
    organizationId: string,
    userId: string,
    invoiceId: string,
    opts: SendOptions,
  ) {
    const { invoice, org } = await this.loadInvoice(organizationId, invoiceId);
    const lang = this.language();
    const recipient = this.recipientFor(
      opts,
      invoice.customer?.email,
      invoice.customerPhone ?? invoice.customer?.phone,
    );
    const pdf = {
      filename: `${invoice.invoiceNumber ?? 'invoice'}.pdf`,
      content: await this.invoices.renderPdf(organizationId, invoiceId),
    };
    const vars = {
      business: org.name,
      customer: invoice.customerName ?? invoice.customer?.name ?? '',
      number: invoice.invoiceNumber ?? '',
      total: money(Number(invoice.total)),
      due: invoice.dueDate ? shortDate(invoice.dueDate, lang) : '—',
      note: opts.message?.trim() ?? '',
    };
    const text = messageText(lang, 'invoice', vars);
    return this.deliver(
      {
        organizationId,
        userId,
        channel: opts.channel,
        kind: MessageKind.INVOICE,
        documentId: invoiceId,
        recipient,
        email: { ...text, attachment: pdf },
        whatsapp: {
          template: process.env.WA_TEMPLATE_INVOICE || 'waresys_invoice',
          params: [
            vars.customer || '-',
            vars.business,
            vars.number,
            vars.total,
            vars.due,
          ],
          pdf,
        },
      },
      org,
    );
  }

  async sendPurchaseOrder(
    organizationId: string,
    userId: string,
    purchaseOrderId: string,
    opts: SendOptions,
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
      include: {
        supplier: { select: { name: true, email: true, phone: true } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'DRAFT')
      throw new BadRequestException(
        'Send the purchase order before sharing it with the supplier',
      );
    const org = await this.orgContact(organizationId);
    const lang = this.language();
    const recipient = this.recipientFor(
      opts,
      po.supplier?.email,
      po.supplier?.phone,
    );
    const pdf = {
      filename: `${po.poNumber ?? 'purchase-order'}.pdf`,
      content: await this.purchaseOrders.renderPdf(
        organizationId,
        purchaseOrderId,
      ),
    };
    const vars = {
      business: org.name,
      supplier: po.supplier?.name ?? '',
      number: po.poNumber ?? '',
      total: money(Number(po.total)),
      note: opts.message?.trim() ?? '',
    };
    return this.deliver(
      {
        organizationId,
        userId,
        channel: opts.channel,
        kind: MessageKind.PURCHASE_ORDER,
        documentId: purchaseOrderId,
        recipient,
        email: { ...messageText(lang, 'purchaseOrder', vars), attachment: pdf },
        whatsapp: {
          template:
            process.env.WA_TEMPLATE_PURCHASE_ORDER || 'waresys_purchase_order',
          params: [
            vars.supplier || '-',
            vars.business,
            vars.number,
            vars.total,
          ],
          pdf,
        },
      },
      org,
    );
  }

  // A statement of account in the message body (no PDF): invoices in the
  // period with what's still owed on each, and the closing balance.
  async sendStatement(
    organizationId: string,
    userId: string,
    customerId: string,
    range: { from: Date; to: Date },
    opts: SendOptions,
  ) {
    const statement = await this.invoices.getCustomerStatement(
      organizationId,
      customerId,
      range.from,
      range.to,
    );
    const customer = await this.prisma.customer.findFirstOrThrow({
      where: { id: customerId, organizationId },
      select: { name: true, email: true, phone: true },
    });
    const org = await this.orgContact(organizationId);
    const lang = this.language();
    const recipient = this.recipientFor(opts, customer.email, customer.phone);
    const vars = {
      business: org.name,
      customer: customer.name,
      period: `${shortDate(range.from, lang)} – ${shortDate(range.to, lang)}`,
      balance: money(Number(statement.closingBalance)),
      lines: statement.lines
        .filter((l) => l.balance > 0)
        .map((l) => ({
          number: l.invoiceNumber ?? '',
          date: l.issuedAt ? shortDate(l.issuedAt, lang) : '',
          balance: money(l.balance),
        })),
      note: opts.message?.trim() ?? '',
    };
    return this.deliver(
      {
        organizationId,
        userId,
        channel: opts.channel,
        kind: MessageKind.STATEMENT,
        documentId: customerId,
        recipient,
        email: messageText(lang, 'statement', vars),
        whatsapp: {
          template: process.env.WA_TEMPLATE_STATEMENT || 'waresys_statement',
          params: [vars.customer, vars.business, vars.period, vars.balance],
        },
      },
      org,
    );
  }

  messageLog(organizationId: string, documentId?: string) {
    return this.prisma.messageLog.findMany({
      where: { organizationId, ...(documentId && { documentId }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ---- automatic payment reminders -----------------------------------

  // Every morning: for orgs that turned reminders on, each unpaid invoice
  // whose due date is exactly a reminder stage away gets one reminder per
  // enabled channel. reminderKey makes a stage go out once, even if the job
  // runs twice or a stage is retried after a failure.
  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: CRON_TIMEZONE })
  async runPaymentReminders() {
    const orgs = await this.prisma.organization.findMany({
      where: {
        OR: [{ reminderEmailEnabled: true }, { reminderWhatsappEnabled: true }],
        suspendedAt: null,
        // Same modules MessagingController requires — an org whose
        // subscription lapsed shouldn't keep being charged for reminders.
        modules: {
          some: {
            module: { in: [ModuleKey.INVOICE_POS, ModuleKey.WORKSHOP_RMS] },
            enabled: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        },
      },
      select: {
        id: true,
        timezone: true,
        reminderEmailEnabled: true,
        reminderWhatsappEnabled: true,
      },
    });
    for (const org of orgs) {
      try {
        await this.remindOrg(org);
      } catch (err) {
        this.logger.warn(`Payment reminders failed for org ${org.id}: ${err}`);
      }
    }
  }

  async remindOrg(org: {
    id: string;
    timezone: string | null;
    reminderEmailEnabled: boolean;
    reminderWhatsappEnabled: boolean;
  }) {
    const today = todayBusinessDate(resolveTimezone(org));
    const channels = [
      ...(org.reminderEmailEnabled ? [MessageChannel.EMAIL] : []),
      ...(org.reminderWhatsappEnabled && this.whatsapp
        ? [MessageChannel.WHATSAPP]
        : []),
    ];
    let sent = 0;
    for (const stage of REMINDER_STAGES) {
      // dueDate is stored as an instant; match the whole business day.
      const dueDay = new Date(today.getTime() - stage * DAY);
      const invoices = await this.prisma.invoice.findMany({
        where: {
          organizationId: org.id,
          status: InvoiceStatus.ISSUED,
          paymentStatus: { not: 'PAID' },
          dueDate: { gte: dueDay, lt: new Date(dueDay.getTime() + DAY) },
        },
        select: {
          id: true,
          total: true,
          amountPaid: true,
          creditedAmount: true,
        },
      });
      for (const inv of invoices) {
        if (
          Number(inv.total) -
            Number(inv.amountPaid) -
            Number(inv.creditedAmount) <=
          0
        )
          continue;
        for (const channel of channels) {
          const reminderKey = `${inv.id}:${stage}:${channel}`;
          const already = await this.prisma.messageLog.findUnique({
            where: {
              organizationId_reminderKey: {
                organizationId: org.id,
                reminderKey,
              },
            },
          });
          if (already) continue;
          try {
            await this.sendReminder(
              org.id,
              inv.id,
              stage,
              channel,
              reminderKey,
            );
            sent++;
          } catch (err) {
            // No address/number, or no balance: nothing to retry today.
            this.logger.debug(
              `Reminder ${reminderKey} skipped: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
      }
    }
    return sent;
  }

  private async sendReminder(
    organizationId: string,
    invoiceId: string,
    stage: number,
    channel: MessageChannel,
    reminderKey: string,
  ) {
    const { invoice, org } = await this.loadInvoice(organizationId, invoiceId);
    const lang = this.language();
    const recipient = this.recipientFor(
      { channel },
      invoice.customer?.email,
      invoice.customerPhone ?? invoice.customer?.phone,
    );
    const due =
      Number(invoice.total) -
      Number(invoice.amountPaid) -
      Number(invoice.creditedAmount);
    const vars = {
      business: org.name,
      customer: invoice.customerName ?? invoice.customer?.name ?? '',
      number: invoice.invoiceNumber ?? '',
      amount: money(due),
      due: invoice.dueDate ? shortDate(invoice.dueDate, lang) : '—',
      stage,
      bank: org.bank,
    };
    const pdf = {
      filename: `${invoice.invoiceNumber ?? 'invoice'}.pdf`,
      content: await this.invoices.renderPdf(organizationId, invoiceId),
    };
    return this.deliver(
      {
        organizationId,
        userId: null,
        channel,
        kind: MessageKind.PAYMENT_REMINDER,
        documentId: invoiceId,
        recipient,
        reminderKey,
        email: { ...messageText(lang, 'reminder', vars), attachment: pdf },
        whatsapp: {
          template:
            process.env.WA_TEMPLATE_REMINDER || 'waresys_payment_reminder',
          params: [
            vars.customer || '-',
            vars.business,
            vars.number,
            vars.amount,
            vars.due,
          ],
          pdf,
        },
      },
      org,
    );
  }

  // ---- delivery --------------------------------------------------------

  private async deliver(
    msg: Outgoing,
    org: { name: string; email: string | null },
  ) {
    if (msg.channel === MessageChannel.EMAIL)
      return this.deliverEmail(msg, org);
    return this.deliverWhatsApp(msg);
  }

  private async deliverEmail(
    msg: Outgoing,
    org: { name: string; email: string | null },
  ) {
    if (!this.mailer.isConfigured())
      throw new ServiceUnavailableException(
        'Email is not set up on this server.',
      );
    const email = msg.email!;
    try {
      await this.mailer.send({
        to: msg.recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: org.name,
        replyTo: org.email ?? undefined,
        attachments: email.attachment
          ? [{ ...email.attachment, contentType: 'application/pdf' }]
          : undefined,
      });
      return this.log(msg, MessageStatus.SENT, {});
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.log(msg, MessageStatus.FAILED, { error });
      throw new ServiceUnavailableException(
        `Email could not be sent: ${error}`,
      );
    }
  }

  private async deliverWhatsApp(msg: Outgoing) {
    if (!this.whatsapp)
      throw new ServiceUnavailableException(
        'WhatsApp is not set up on this server.',
      );
    const wa = msg.whatsapp!;
    const price = waPricePerMessage();

    // Charged first, in its own transaction: the balance is locked and
    // checked, so two sends can't both spend the last message's worth.
    const charge = await this.prisma.$transaction((tx) =>
      chargeWaMessage(tx, msg.organizationId, price, msg.userId),
    );

    let attachmentKey: string | undefined;
    let document: { url: string; filename: string } | undefined;
    try {
      if (wa.pdf) {
        attachmentKey = `outbound-docs/${msg.organizationId}/${randomUUID()}.pdf`;
        await this.storage.put(
          attachmentKey,
          wa.pdf.content,
          'application/pdf',
        );
        const signed = this.signer.sign(attachmentKey, ATTACHMENT_TTL_SECONDS);
        document = {
          url: `${(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/api${signed.path}`,
          filename: wa.pdf.filename,
        };
      }
    } catch (err) {
      await this.prisma.$transaction((tx) =>
        refundWaMessage(
          tx,
          msg.organizationId,
          price,
          'Attachment upload failed',
        ),
      );
      throw err;
    }

    const result = await this.whatsapp.send({
      to: msg.recipient,
      template: wa.template,
      language:
        process.env.WA_TEMPLATE_LANGUAGE ||
        (this.language() === 'en' ? 'en' : 'id'),
      bodyParams: wa.params,
      document,
    });

    if (!result.ok) {
      await this.prisma.$transaction((tx) =>
        refundWaMessage(
          tx,
          msg.organizationId,
          price,
          `Not delivered: ${result.error}`.slice(0, 500),
        ),
      );
      await this.log(msg, MessageStatus.FAILED, {
        error: result.error,
        attachmentKey,
      });
      throw new ServiceUnavailableException(
        `WhatsApp message could not be sent: ${result.error}`,
      );
    }
    const logged = await this.log(msg, MessageStatus.SENT, {
      cost: price,
      providerMessageId: result.messageId,
      attachmentKey,
    });
    await this.prisma.waLedgerEntry.update({
      where: { id: charge.id },
      data: { messageLogId: logged.id },
    });
    await this.warnIfLow(msg.organizationId, price);
    return logged;
  }

  private log(
    msg: Outgoing,
    status: MessageStatus,
    extra: {
      error?: string;
      cost?: number;
      providerMessageId?: string;
      attachmentKey?: string;
    },
  ) {
    return this.prisma.messageLog.create({
      data: {
        organizationId: msg.organizationId,
        channel: msg.channel,
        kind: msg.kind,
        documentId: msg.documentId,
        recipient: msg.recipient,
        status,
        error: extra.error?.slice(0, 1000),
        cost: extra.cost ?? 0,
        providerMessageId: extra.providerMessageId,
        attachmentKey: extra.attachmentKey,
        // A failed reminder keeps no key, so tomorrow's run can try again.
        reminderKey: status === MessageStatus.SENT ? msg.reminderKey : null,
        sentById: msg.userId,
      },
    });
  }

  private async warnIfLow(organizationId: string, price: number) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { waBalance: true, waLowBalanceNotifiedAt: true },
    });
    if (
      org.waLowBalanceNotifiedAt ||
      Number(org.waBalance) >= price * LOW_BALANCE_MESSAGES
    )
      return;
    const claimed = await this.prisma.organization.updateMany({
      where: { id: organizationId, waLowBalanceNotifiedAt: null },
      data: { waLowBalanceNotifiedAt: new Date() },
    });
    if (claimed.count === 0) return;
    const admins = await this.prisma.user.findMany({
      where: { organizationId, role: 'ADMIN', active: true, removedAt: null },
      select: { id: true },
    });
    await this.notifications.createMany(
      organizationId,
      admins.map((a) => a.id),
      'WA_BALANCE_LOW',
      'WhatsApp balance is running low',
      {
        body: `Rp ${Number(org.waBalance).toLocaleString('id-ID')} left — about ${Math.floor(Number(org.waBalance) / price)} messages.`,
        link: '/settings/whatsapp',
      },
    );
  }

  // WhatsApp document links expire after a week; the PDFs behind them go too.
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { timeZone: CRON_TIMEZONE })
  async cleanupAttachments() {
    const old = await this.prisma.messageLog.findMany({
      where: {
        attachmentKey: { not: null },
        createdAt: {
          lt: new Date(Date.now() - ATTACHMENT_TTL_SECONDS * 1000 - DAY),
        },
      },
      select: { id: true, attachmentKey: true },
      take: 1000,
    });
    for (const row of old) {
      try {
        await this.storage.delete(row.attachmentKey!);
      } catch {
        // already gone
      }
      await this.prisma.messageLog.update({
        where: { id: row.id },
        data: { attachmentKey: null },
      });
    }
  }

  // ---- helpers -----------------------------------------------------------

  private recipientFor(
    opts: SendOptions,
    email: string | null | undefined,
    phone: string | null | undefined,
  ): string {
    if (opts.channel === MessageChannel.EMAIL) {
      const to = (opts.to ?? email ?? '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
        throw new BadRequestException('A valid email address is needed');
      return to;
    }
    const to = normalizeWhatsAppNumber(opts.to ?? phone);
    if (!to) throw new BadRequestException('A valid WhatsApp number is needed');
    return to;
  }

  private async orgContact(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        name: true,
        legalName: true,
        bankAccounts: {
          where: { archivedAt: null },
          select: { bankName: true, accountNumber: true, accountName: true },
          take: 1,
        },
        users: {
          where: { role: 'ADMIN', active: true, removedAt: null },
          select: { email: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });
    const bank = org.bankAccounts[0];
    return {
      name: org.legalName || org.name,
      // Replies go to the first admin rather than the WareSys sender.
      email: org.users[0]?.email ?? null,
      bank: bank
        ? `${bank.bankName} ${bank.accountNumber} a.n. ${bank.accountName}`
        : null,
    };
  }

  private async loadInvoice(organizationId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        customer: { select: { name: true, email: true, phone: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== InvoiceStatus.ISSUED)
      throw new BadRequestException('Only issued invoices can be sent');
    return { invoice, org: await this.orgContact(organizationId) };
  }
}
