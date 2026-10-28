import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ensureDefaultBranch } from '../branches/resolve-branch';
import { NotificationsService } from '../notifications/notifications.service';
import { PlanLimitsService } from '../billing/plan-limits.service';

// Who is acting: MASTER manages everyone; an ADMIN manages the drivers and
// the ADMINs/USERs of their own branch, never a MASTER.
export type MemberActor = { sub: string; role: string; branchId?: string | null };

type MemberRole = 'MASTER' | 'ADMIN' | 'USER' | 'DRIVER';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private planLimits: PlanLimitsService,
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
  async setActive(
    organizationId: string,
    actor: MemberActor,
    userId: string,
    active: boolean,
  ) {
    const actorId = actor.sub;
    const user = await this.getManageable(organizationId, actor, userId);
    // Locked users don't hold a seat, so unlocking takes one — same check
    // as AuthService.invite, otherwise lock/unlock would bypass the limit.
    if (active && !user.active) await this.assertSeatAvailable(organizationId);
    // Same guards as removeMember(): locking yourself, or the last active
    // admin, would leave the organization with nobody able to manage it.
    if (!active) {
      if (userId === actorId) {
        throw new BadRequestException("You can't lock your own account");
      }
      if (user.role === 'MASTER' && user.active) {
        await this.assertAnotherActiveMaster(organizationId, userId);
      }
    }

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
  // A branch ADMIN sees the drivers and their own branch's members; seat
  // usage is still the whole business's.
  async listMembers(organizationId: string, actor: MemberActor) {
    const branchOnly = actor.role !== 'MASTER';
    const [seatLimit, seatsUsed, members] = await Promise.all([
      this.planLimits.seatLimit(organizationId),
      this.prisma.user.count({ where: { organizationId, removedAt: null, active: true } }),
      this.prisma.user.findMany({
        where: {
          organizationId,
          removedAt: null,
          ...(branchOnly && {
            OR: [{ role: 'DRIVER' }, { role: { in: ['ADMIN', 'USER'] }, branchId: actor.branchId ?? '' }],
          }),
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          active: true,
          avatarUrl: true,
          createdAt: true,
          team: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy: [{ role: 'asc' }, { email: 'asc' }],
      }),
    ]);
    return {
      // null = unlimited (a plan with no seat cap).
      seatLimit,
      seatsUsed,
      members,
    };
  }

  async assertSeatAvailable(organizationId: string) {
    await this.planLimits.assertCanAdd(organizationId, 'seats');
  }

  // Soft removal — see User.removedAt. Ends the session immediately (same
  // as locking), drops team membership, and revokes the member's devices
  // and push subscriptions so nothing keeps working on their behalf.
  async removeMember(organizationId: string, actor: MemberActor, userId: string) {
    if (userId === actor.sub) {
      throw new BadRequestException("You can't remove yourself");
    }
    const user = await this.getManageable(organizationId, actor, userId);

    if (user.role === 'MASTER') {
      await this.assertAnotherActiveMaster(organizationId, userId);
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
    actor: MemberActor,
    userId: string,
    displayName: string | null,
  ) {
    await this.getManageable(organizationId, actor, userId);

    return this.prisma.user.update({
      where: { id: userId },
      data: { displayName: displayName?.trim() || null },
      select: { id: true, email: true, displayName: true },
    });
  }

  // Changes a member's role. The role is re-read from the database on every
  // request (jwt.strategy.ts), but the member's session is still ended so
  // the app reloads with the right menus — and so a member becoming a DRIVER
  // goes through device approval on their next sign-in. Leaving DRIVER also
  // drops the team, which only ever holds drivers.
  async setRole(
    organizationId: string,
    actor: MemberActor,
    userId: string,
    role: MemberRole,
  ) {
    if (userId === actor.sub) {
      throw new BadRequestException("You can't change your own role");
    }
    if (role === 'MASTER' && actor.role !== 'MASTER') {
      throw new ForbiddenException('Only a master account can make another master');
    }
    const user = await this.getManageable(organizationId, actor, userId);
    if (user.role === role) {
      return { id: user.id, email: user.email, role: user.role };
    }
    if (user.role === 'MASTER' && user.active) {
      await this.assertAnotherActiveMaster(organizationId, userId);
    }
    // Becoming branch staff needs a branch: keep theirs, else the acting
    // ADMIN's, else the first.
    const branchId =
      role === 'ADMIN' || role === 'USER'
        ? user.branchId ?? actor.branchId ?? (await ensureDefaultBranch(this.prisma, organizationId)).id
        : null;

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        role,
        branchId,
        currentSessionId: null,
        ...(role !== 'DRIVER' ? { teamId: null } : {}),
      },
      select: { id: true, email: true, role: true, branchId: true },
    });
  }

  // Moves an ADMIN or USER to another branch (MASTER only — see the
  // controller). They see the new branch's records from their next request.
  async setBranch(organizationId: string, userId: string, branchId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId, removedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'ADMIN' && user.role !== 'USER') {
      throw new BadRequestException('Only admins and users work at a branch');
    }
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('Branch not found');
    return this.prisma.user.update({
      where: { id: userId },
      data: { branchId: branch.id },
      select: { id: true, email: true, role: true, branchId: true },
    });
  }

  // A member the actor may manage; anyone else reads as missing.
  private async getManageable(organizationId: string, actor: MemberActor, userId: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId, removedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');
    if (actor.role === 'MASTER' || user.role === 'DRIVER') return user;
    if (user.role === 'MASTER') {
      throw new ForbiddenException('Only a master account can change a master account');
    }
    if (!actor.branchId || user.branchId !== actor.branchId) throw new NotFoundException('User not found');
    return user;
  }

  // Someone must always be able to run the whole business.
  private async assertAnotherActiveMaster(organizationId: string, userId: string) {
    const otherMasters = await this.prisma.user.count({
      where: {
        organizationId,
        role: 'MASTER',
        active: true,
        removedAt: null,
        id: { not: userId },
      },
    });
    if (otherMasters === 0) {
      throw new BadRequestException(
        "This is the organization's last active master account",
      );
    }
  }
}
