import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async listDrivers(organizationId: string) {
    return this.prisma.user.findMany({
      where: { organizationId, role: 'DRIVER' },
      select: {
        id: true,
        email: true,
        active: true,
        teamId: true,
        createdAt: true,
      },
      orderBy: { email: 'asc' },
    });
  }

  // Locking a user also kills their current session immediately (same
  // "invalidate on state change" pattern as AuthService.resetPassword/
  // confirmPasswordChange) — otherwise a locked driver would stay logged
  // in on an already-issued token for up to its full 7-day life.
  async setActive(organizationId: string, userId: string, active: boolean) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
    });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        active,
        ...(active ? {} : { currentSessionId: null }),
      },
      select: { id: true, email: true, active: true, role: true },
    });

    await this.notifications.create(
      organizationId,
      userId,
      active ? 'ACCOUNT_UNLOCKED' : 'ACCOUNT_LOCKED',
      active ? 'Your account was unlocked' : 'Your account was locked',
    );

    return updated;
  }
}
