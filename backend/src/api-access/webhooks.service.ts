import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, WebhookDeliveryStatus } from '@prisma/client';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { assertPublicWebhookUrl } from './webhook-url';

export const WEBHOOK_EVENTS = [
  'invoice.issued',
  'invoice.voided',
  'payment.recorded',
  'purchase_order.sent',
  'goods_receipt.created',
  'stock_transfer.received',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// Minutes to wait before each retry; after the last, the delivery fails.
const RETRY_DELAYS_MIN = [1, 5, 30, 120, 360];
const MAX_CONSECUTIVE_FAILURES = 50;
const BATCH = 50;
const TIMEOUT_MS = 10_000;

// Outgoing webhooks. emit() only queues (one row per subscribed endpoint),
// so the business action that triggered it never waits on, or fails
// because of, someone else's server; the dispatcher delivers every minute
// and retries with backoff.
//
// Each request is signed: X-WareSys-Signature: t=<unix>,v1=<hex> where v1
// is HMAC-SHA256(secret, "<t>.<raw body>") — the receiver recomputes it
// and checks t is recent, the same scheme Stripe uses.
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private dispatching = false;

  constructor(private prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(organizationId: string, dto: { url: string; events: string[] }) {
    const events = this.validEvents(dto.events);
    await this.checkUrl(dto.url);
    return this.prisma.webhookEndpoint.create({
      data: {
        organizationId,
        url: dto.url.trim(),
        events,
        secret: `whsec_${randomBytes(24).toString('base64url')}`,
      },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: { url?: string; events?: string[]; active?: boolean },
  ) {
    await this.get(organizationId, id);
    if (dto.url !== undefined) await this.checkUrl(dto.url);
    return this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        ...(dto.url !== undefined && { url: dto.url.trim() }),
        ...(dto.events !== undefined && {
          events: this.validEvents(dto.events),
        }),
        // Re-enabling clears the failure streak that switched it off.
        ...(dto.active !== undefined && {
          active: dto.active,
          ...(dto.active && { disabledAt: null, consecutiveFailures: 0 }),
        }),
      },
    });
  }

  async remove(organizationId: string, id: string) {
    await this.get(organizationId, id);
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    return { ok: true };
  }

  async deliveries(organizationId: string, id: string) {
    await this.get(organizationId, id);
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // Queues a "ping" to this endpoint only, delivered right away.
  async test(organizationId: string, id: string) {
    const endpoint = await this.get(organizationId, id);
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        event: 'ping',
        payload: this.envelope('ping', organizationId, {
          message: 'Hello from WareSys',
        }),
      },
    });
    await this.deliver(delivery.id);
    return this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
  }

  // Best-effort by design: callers fire and forget after their own
  // transaction commits, and a failure here is logged, never thrown.
  async emit(
    organizationId: string,
    event: WebhookEvent,
    data: Record<string, unknown>,
  ) {
    try {
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: { organizationId, active: true, events: { has: event } },
        select: { id: true },
      });
      if (endpoints.length === 0) return;
      const payload = this.envelope(event, organizationId, data);
      await this.prisma.webhookDelivery.createMany({
        data: endpoints.map((e) => ({ endpointId: e.id, event, payload })),
      });
    } catch (err) {
      this.logger.warn(
        `Could not queue ${event} for org ${organizationId}: ${err}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchDue() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const due = await this.prisma.webhookDelivery.findMany({
        where: {
          status: WebhookDeliveryStatus.PENDING,
          nextAttemptAt: { lte: new Date() },
          endpoint: { active: true },
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: BATCH,
        select: { id: true },
      });
      for (const d of due) await this.deliver(d.id);
    } finally {
      this.dispatching = false;
    }
  }

  async deliver(deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!delivery || delivery.status !== WebhookDeliveryStatus.PENDING) return;
    const body = JSON.stringify(delivery.payload);
    const t = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', delivery.endpoint.secret)
      .update(`${t}.${body}`)
      .digest('hex');

    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      await assertPublicWebhookUrl(delivery.endpoint.url);
      const res = await fetch(delivery.endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WareSys-Webhooks/1',
          'X-WareSys-Event': delivery.event,
          'X-WareSys-Delivery': delivery.id,
          'X-WareSys-Signature': `t=${t},v1=${signature}`,
        },
        body,
        // A redirect could point anywhere, including inside our network.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      statusCode = res.status;
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const attempts = delivery.attempts + 1;
    if (!error) {
      await this.prisma.$transaction([
        this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: WebhookDeliveryStatus.SUCCEEDED,
            attempts,
            lastStatusCode: statusCode,
            lastError: null,
            deliveredAt: new Date(),
          },
        }),
        this.prisma.webhookEndpoint.update({
          where: { id: delivery.endpointId },
          data: { consecutiveFailures: 0 },
        }),
      ]);
      return;
    }

    const retryIn = RETRY_DELAYS_MIN[attempts - 1];
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        lastStatusCode: statusCode,
        lastError: error.slice(0, 500),
        ...(retryIn === undefined || delivery.event === 'ping'
          ? { status: WebhookDeliveryStatus.FAILED }
          : { nextAttemptAt: new Date(Date.now() + retryIn * 60_000) }),
      },
    });
    const endpoint = await this.prisma.webhookEndpoint.update({
      where: { id: delivery.endpointId },
      data: { consecutiveFailures: { increment: 1 } },
    });
    if (
      endpoint.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES &&
      endpoint.active
    ) {
      await this.prisma.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { active: false, disabledAt: new Date() },
      });
      this.logger.warn(
        `Webhook endpoint ${endpoint.id} disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`,
      );
    }
  }

  private envelope(
    event: string,
    organizationId: string,
    data: Record<string, unknown>,
  ): Prisma.InputJsonObject {
    return {
      id: `evt_${randomBytes(12).toString('hex')}`,
      type: event,
      createdAt: new Date().toISOString(),
      organizationId,
      data: data as Prisma.InputJsonObject,
    };
  }

  private validEvents(events: string[]) {
    const unique = [...new Set(events)];
    const unknown = unique.filter(
      (e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e),
    );
    if (unique.length === 0)
      throw new BadRequestException('Pick at least one event');
    if (unknown.length)
      throw new BadRequestException(`Unknown events: ${unknown.join(', ')}`);
    return unique;
  }

  private async checkUrl(url: string) {
    try {
      await assertPublicWebhookUrl(url.trim());
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid URL',
      );
    }
  }

  private async get(organizationId: string, id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, organizationId },
    });
    if (!endpoint) throw new NotFoundException('Webhook endpoint not found');
    return endpoint;
  }
}
