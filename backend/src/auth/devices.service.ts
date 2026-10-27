import { Injectable, NotFoundException } from '@nestjs/common';
import { DeviceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export type DeviceCheckResult = 'OK' | 'PENDING' | 'REJECTED';

// A blocked phone retrying every few seconds shouldn't flood the office.
const BLOCKED_ATTEMPT_NOTIFY_MS = 60 * 60 * 1000;

// Lives inside AuthModule (not its own module) so AuthService can inject it
// directly without a circular import — the admin-facing DevicesController
// lives in its own DevicesModule, which imports AuthModule to reuse this
// same service instance (see devices.module.ts).
@Injectable()
export class DevicesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // Called from AuthService.login() for DRIVER accounts, before a token is
  // issued. A driver's very first device auto-approves (so onboarding isn't
  // blocked); any device after that starts PENDING and blocks login until
  // an admin approves it.
  async registerOrCheck(
    organizationId: string,
    userId: string,
    deviceId: string,
    userAgent?: string,
  ): Promise<DeviceCheckResult> {
    const existing = await this.prisma.device.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
    });

    if (existing) {
      if (existing.status === 'APPROVED') {
        await this.prisma.device.update({
          where: { id: existing.id },
          data: {
            lastSeenAt: new Date(),
            userAgent: userAgent ?? existing.userAgent,
          },
        });
        return 'OK';
      }
      if (existing.status === 'PENDING') return 'PENDING';
      // REJECTED or REVOKED: still refused, but no longer silently — the
      // office is told (at most hourly per phone) and can approve it again
      // from the Drivers page, where the attempt shows.
      await this.reportBlockedAttempt(organizationId, userId, existing);
      return 'REJECTED';
    }

    // "Very first" means no device row of any status — not "no APPROVED
    // device right now". Counting only APPROVED let a driver whose phone
    // an admin had revoked or rejected clear site storage, present a fresh
    // device id, and be auto-approved again, undoing the revoke.
    const knownDevices = await this.prisma.device.count({
      where: { userId },
    });

    if (knownDevices === 0) {
      await this.prisma.device.create({
        data: {
          userId,
          deviceId,
          userAgent,
          status: 'APPROVED',
          approvedAt: new Date(),
        },
      });
      return 'OK';
    }

    await this.prisma.device.create({
      data: { userId, deviceId, userAgent, status: 'PENDING' },
    });
    await this.notifications.notifyOrgStaff(
      organizationId,
      'DEVICE_PENDING_APPROVAL',
      'A driver logged in from a new device',
      { link: '/delivery/drivers' },
    );
    return 'PENDING';
  }

  private async reportBlockedAttempt(
    organizationId: string,
    userId: string,
    device: { id: string; lastBlockedAttemptAt: Date | null },
  ) {
    const now = new Date();
    await this.prisma.device.update({
      where: { id: device.id },
      data: { lastBlockedAttemptAt: now },
    });
    const last = device.lastBlockedAttemptAt?.getTime() ?? 0;
    if (now.getTime() - last < BLOCKED_ATTEMPT_NOTIFY_MS) return;
    const driver = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, displayName: true },
    });
    await this.notifications.notifyOrgStaff(
      organizationId,
      'DEVICE_BLOCKED_ATTEMPT',
      `${driver?.displayName || driver?.email || 'A driver'} tried to sign in on a blocked phone`,
      {
        body: 'If it is theirs, approve it again on the Drivers page.',
        link: '/delivery/drivers',
        payload: { userId, deviceId: device.id },
      },
    );
  }

  // Best-effort per-request freshness update, called from jwt.strategy.ts —
  // never blocks or throws on a mismatch, since enforcement itself happens
  // only at login time and via revoke(), not on every request.
  async touchLastSeen(userId: string, deviceId: string) {
    try {
      await this.prisma.device.updateMany({
        where: { userId, deviceId, status: 'APPROVED' },
        data: { lastSeenAt: new Date() },
      });
    } catch {
      // best-effort only
    }
  }

  async listForOrg(
    organizationId: string,
    filters: { userId?: string; status?: string } = {},
  ) {
    return this.prisma.device.findMany({
      where: {
        user: { organizationId },
        ...(filters.userId ? { userId: filters.userId } : {}),
        ...(filters.status ? { status: filters.status as DeviceStatus } : {}),
      },
      include: { user: { select: { id: true, email: true, displayName: true } } },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  private async getOrgScopedDevice(organizationId: string, deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, user: { organizationId } },
    });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  // One phone per driver: approving a new device retires the driver's
  // other approved ones (REVOKED) and ends whatever session is live, so
  // the old phone is signed out and can't come back without approval.
  async approve(organizationId: string, deviceId: string, adminId: string) {
    const device = await this.getOrgScopedDevice(organizationId, deviceId);
    const [updated, replaced] = await this.prisma.$transaction([
      this.prisma.device.update({
        where: { id: device.id },
        // Any status: a rejected or revoked phone can be approved again.
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedByUserId: adminId,
          lastBlockedAttemptAt: null,
        },
      }),
      this.prisma.device.updateMany({
        where: { userId: device.userId, status: 'APPROVED', id: { not: device.id } },
        data: { status: 'REVOKED' },
      }),
    ]);
    if (replaced.count > 0) {
      await this.prisma.user.update({
        where: { id: device.userId },
        data: { currentSessionId: null },
      });
    }
    await this.notifications.create(
      organizationId,
      device.userId,
      'DEVICE_APPROVED',
      'Your device was approved',
    );
    return updated;
  }

  async reject(organizationId: string, deviceId: string) {
    const device = await this.getOrgScopedDevice(organizationId, deviceId);
    const updated = await this.prisma.device.update({
      where: { id: device.id },
      data: { status: 'REJECTED' },
    });
    await this.notifications.create(
      organizationId,
      device.userId,
      'DEVICE_REJECTED',
      'Your device was rejected',
    );
    return updated;
  }

  // Revoking a device the driver is actively using should kill their live
  // session immediately, same "invalidate on state change" pattern as
  // lock/unlock (UsersService.setActive) and password reset.
  async revoke(organizationId: string, deviceId: string) {
    const device = await this.getOrgScopedDevice(organizationId, deviceId);
    const [updated] = await this.prisma.$transaction([
      this.prisma.device.update({
        where: { id: device.id },
        data: { status: 'REVOKED' },
      }),
      this.prisma.user.update({
        where: { id: device.userId },
        data: { currentSessionId: null },
      }),
    ]);
    await this.notifications.create(
      organizationId,
      device.userId,
      'DEVICE_REVOKED',
      'A device was revoked from your account',
    );
    return updated;
  }
}
