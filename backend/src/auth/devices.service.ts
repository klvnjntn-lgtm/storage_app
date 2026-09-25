import { Injectable, NotFoundException } from '@nestjs/common';
import { DeviceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export type DeviceCheckResult = 'OK' | 'PENDING' | 'REJECTED';

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
      return 'REJECTED'; // REJECTED or REVOKED
    }

    const approvedCount = await this.prisma.device.count({
      where: { userId, status: 'APPROVED' },
    });

    if (approvedCount === 0) {
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
      include: { user: { select: { id: true, email: true } } },
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

  async approve(organizationId: string, deviceId: string, adminId: string) {
    const device = await this.getOrgScopedDevice(organizationId, deviceId);
    const updated = await this.prisma.device.update({
      where: { id: device.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedByUserId: adminId,
      },
    });
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
