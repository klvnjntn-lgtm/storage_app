import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';

export type CreateNotificationOptions = {
  body?: string;
  payload?: Prisma.InputJsonValue;
  link?: string;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private push: PushService,
  ) {}

  // Best-effort: a notification failing to write must never break the
  // caller's real mutation (route reassigned, delivery marked failed, …),
  // so every write here is swallowed and logged rather than thrown — same
  // convention as RouteHistoryEvent writes in delivery-routes.service.ts.
  async create(
    organizationId: string,
    userId: string,
    type: NotificationType,
    title: string,
    opts: CreateNotificationOptions = {},
  ) {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          organizationId,
          userId,
          type,
          title,
          body: opts.body,
          payload: opts.payload,
          link: opts.link,
        },
      });
      void this.push.sendToUser(userId, {
        title,
        body: opts.body,
        link: opts.link,
      });
      return notification;
    } catch (err) {
      this.logger.warn(
        `Failed to create notification (${type}) for user ${userId}: ${err}`,
      );
      return null;
    }
  }

  async createMany(
    organizationId: string,
    userIds: string[],
    type: NotificationType,
    title: string,
    opts: CreateNotificationOptions = {},
  ) {
    if (userIds.length === 0) return { count: 0 };
    try {
      const result = await this.prisma.notification.createMany({
        data: userIds.map((userId) => ({
          organizationId,
          userId,
          type,
          title,
          body: opts.body,
          payload: opts.payload,
          link: opts.link,
        })),
      });
      for (const userId of userIds) {
        void this.push.sendToUser(userId, {
          title,
          body: opts.body,
          link: opts.link,
        });
      }
      return result;
    } catch (err) {
      this.logger.warn(
        `Failed to create notifications (${type}) for ${userIds.length} users: ${err}`,
      );
      return { count: 0 };
    }
  }

  // Convenience for "tell every admin/dispatcher" triggers (e.g. a failed
  // delivery) — ADMIN and USER are both office/dispatch roles; DRIVER is
  // excluded since drivers aren't the audience for org-wide alerts.
  async notifyOrgStaff(
    organizationId: string,
    type: NotificationType,
    title: string,
    opts: CreateNotificationOptions = {},
  ) {
    const staff = await this.prisma.user.findMany({
      where: { organizationId, role: { in: ['ADMIN', 'USER'] }, active: true },
      select: { id: true },
    });
    return this.createMany(
      organizationId,
      staff.map((u) => u.id),
      type,
      title,
      opts,
    );
  }

  async listMine(
    organizationId: string,
    userId: string,
    opts: { page?: number; pageSize?: number; unreadOnly?: boolean } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const where: Prisma.NotificationWhereInput = {
      organizationId,
      userId,
      ...(opts.unreadOnly ? { readAt: null } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async unreadCount(organizationId: string, userId: string) {
    const count = await this.prisma.notification.count({
      where: { organizationId, userId, readAt: null },
    });
    return { count };
  }

  async markRead(organizationId: string, userId: string, id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, organizationId, userId },
      data: { readAt: new Date() },
    });
    return { updated: result.count > 0 };
  }

  async markAllRead(organizationId: string, userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { organizationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }
}
