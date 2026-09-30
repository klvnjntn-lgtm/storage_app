import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
      where: { organizationId, role: 'DRIVER', removedAt: null },
      select: {
        id: true,
        email: true,
        displayName: true,
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
      where: { id: userId, organizationId, removedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');
    // Locked users don't hold a seat, so unlocking takes one — same check
    // as AuthService.invite, otherwise lock/unlock would bypass the limit.
    if (active && !user.active) await this.assertSeatAvailable(organizationId);

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

  // All current (non-removed) members plus seat usage. Seats are held by
  // active members only — locked or removed users free theirs.
  async listMembers(organizationId: string) {
    const [org, members] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { seatLimit: true },
      }),
      this.prisma.user.findMany({
        where: { organizationId, removedAt: null },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          active: true,
          avatarUrl: true,
          createdAt: true,
          team: { select: { id: true, name: true } },
        },
        orderBy: [{ role: 'asc' }, { email: 'asc' }],
      }),
    ]);
    return {
      seatLimit: org.seatLimit,
      seatsUsed: members.filter((m) => m.active).length,
      members,
    };
  }

  async assertSeatAvailable(organizationId: string) {
    const [org, used] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { seatLimit: true },
      }),
      this.prisma.user.count({
        where: { organizationId, active: true, removedAt: null },
      }),
    ]);
    if (used >= org.seatLimit) {
      throw new ForbiddenException(
        `Seat limit reached (${org.seatLimit}). Upgrade your plan to add more users.`,
      );
    }
  }

  // Soft removal — see User.removedAt. Ends the session immediately (same
  // as locking), drops team membership, and revokes the member's devices
  // and push subscriptions so nothing keeps working on their behalf.
  async removeMember(organizationId: string, actorId: string, userId: string) {
    if (userId === actorId) {
      throw new BadRequestException("You can't remove yourself");
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId, removedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === 'ADMIN') {
      const otherAdmins = await this.prisma.user.count({
        where: {
          organizationId,
          role: 'ADMIN',
          active: true,
          removedAt: null,
          id: { not: userId },
        },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException(
          "Can't remove the last active admin of the organization",
        );
      }
    }

    // Routes belong to the driver's team, not the driver — removing the
    // driver leaves the team (and its routes) waiting for a new driver.

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          active: false,
          removedAt: new Date(),
          currentSessionId: null,
          teamId: null,
        },
      }),
      this.prisma.device.updateMany({
        where: { userId, status: { in: ['PENDING', 'APPROVED'] } },
        data: { status: 'REVOKED' },
      }),
      this.prisma.pushSubscription.deleteMany({ where: { userId } }),
    ]);
    return { id: userId, removed: true };
  }

  async setDisplayName(
    organizationId: string,
    userId: string,
    displayName: string | null,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
    });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: userId },
      data: { displayName: displayName?.trim() || null },
      select: { id: true, email: true, displayName: true },
    });
  }
}
