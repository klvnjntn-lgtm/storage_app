import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTimezone } from '../accounting/business-date';
import { isWithinAccessWindow } from '../auth/access-schedule.util';
import { AccessScheduleWindowDto } from './dto/upsert-access-schedule.dto';

@Injectable()
export class AccessControlService {
  private readonly logger = new Logger(AccessControlService.name);

  constructor(private prisma: PrismaService) {}

  async listSchedule(organizationId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.driverAccessSchedule.findMany({
      where: { userId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  async replaceSchedule(
    organizationId: string,
    userId: string,
    windows: AccessScheduleWindowDto[],
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
    });
    if (!user) throw new NotFoundException('User not found');

    for (const w of windows) {
      if (w.startTime >= w.endTime) {
        throw new BadRequestException(
          `Invalid window for ${w.dayOfWeek}: endTime must be after startTime (no overnight windows in v1)`,
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.driverAccessSchedule.deleteMany({ where: { userId } }),
      this.prisma.driverAccessSchedule.createMany({
        data: windows.map((w) => ({
          userId,
          dayOfWeek: w.dayOfWeek,
          startTime: w.startTime,
          endTime: w.endTime,
        })),
      }),
    ]);

    return this.listSchedule(organizationId, userId);
  }

  // Proactively logs out any DRIVER currently outside their configured
  // access window, rather than waiting for their next request to hit the
  // same check in jwt.strategy.ts. Single filtered query — must stay cheap
  // at a 1-minute cadence.
  @Cron(CronExpression.EVERY_MINUTE)
  async enforceAccessHours() {
    const candidates = await this.prisma.user.findMany({
      where: {
        role: 'DRIVER',
        currentSessionId: { not: null },
        accessSchedules: { some: {} },
      },
      select: {
        id: true,
        accessSchedules: {
          select: { dayOfWeek: true, startTime: true, endTime: true },
        },
        organization: { select: { timezone: true } },
      },
    });

    const toLogOut: string[] = [];
    for (const user of candidates) {
      const tz = resolveTimezone(user.organization);
      if (!isWithinAccessWindow(user.accessSchedules, new Date(), tz)) {
        toLogOut.push(user.id);
      }
    }

    if (toLogOut.length === 0) return;

    await this.prisma.user.updateMany({
      where: { id: { in: toLogOut } },
      data: { currentSessionId: null },
    });
    this.logger.log(
      `Auto-logged-out ${toLogOut.length} driver(s) outside their access window`,
    );
  }
}
