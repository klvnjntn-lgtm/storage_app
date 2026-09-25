import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

// Self-hosted Web Push (VAPID) — no external push provider/account needed.
// Best-effort throughout: a dead subscription or a misconfigured VAPID key
// must never block the in-app notification write it rides alongside (see
// NotificationsService.create).
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly configured: boolean;

  constructor(private prisma: PrismaService) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
    this.configured = Boolean(publicKey && privateKey);
    if (this.configured) {
      webpush.setVapidDetails(subject, publicKey!, privateKey!);
    } else {
      this.logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push notifications are disabled',
      );
    }
  }

  async subscribe(
    userId: string,
    endpoint: string,
    p256dh: string,
    auth: string,
  ) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh, auth },
      update: { userId, p256dh, auth },
    });
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
  }

  async sendToUser(
    userId: string,
    payload: { title: string; body?: string; link?: string },
  ) {
    if (!this.configured) return;
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload),
          );
        } catch (err) {
          // 404/410 means the browser subscription is gone — prune it so we
          // stop paying for a doomed send every future notification.
          const statusCode =
            err instanceof webpush.WebPushError ? err.statusCode : undefined;
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => undefined);
          } else {
            this.logger.warn(
              `Push send failed for subscription ${sub.id}: ${err}`,
            );
          }
        }
      }),
    );
  }
}
