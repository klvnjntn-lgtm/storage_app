// src/teams/teams.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  async list(organizationId: string) {
    return this.prisma.team.findMany({
      where: { organizationId },
      include: {
        members: {
          where: { removedAt: null },
          select: { id: true, email: true, displayName: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(organizationId: string, dto: CreateTeamDto) {
    try {
      return await this.prisma.team.create({ data: { organizationId, name: dto.name } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(`A team named "${dto.name}" already exists`);
      }
      throw err;
    }
  }

  async rename(organizationId: string, id: string, name: string) {
    const team = await this.prisma.team.findFirst({ where: { id, organizationId } });
    if (!team) throw new NotFoundException('Team not found');
    try {
      return await this.prisma.team.update({ where: { id }, data: { name } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(`A team named "${name}" already exists`);
      }
      throw err;
    }
  }

  async remove(organizationId: string, id: string) {
    const team = await this.prisma.team.findFirst({ where: { id, organizationId } });
    if (!team) throw new NotFoundException('Team not found');
    // Routes reference their team (history included), so a team that has
    // ever had a route stays — rename it or move its driver instead.
    const routes = await this.prisma.route.count({ where: { teamId: id } });
    if (routes > 0) {
      throw new BadRequestException(
        'This team has routes and cannot be deleted — rename it or move its driver instead',
      );
    }
    // Members' teamId is set to null automatically (ON DELETE SET NULL) —
    // deleting a team never deletes driver accounts.
    await this.prisma.team.delete({ where: { id } });
  }

  async assignDriver(organizationId: string, teamId: string, driverId: string) {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundException('Team not found');
    const driver = await this.prisma.user.findFirst({ where: { id: driverId, organizationId, role: 'DRIVER' } });
    if (!driver) throw new NotFoundException('Driver not found (must be a user with the DRIVER role)');

    // One team = one driver: the team's routes are that driver's work.
    const other = await this.prisma.user.findFirst({
      where: { teamId, role: 'DRIVER', removedAt: null, id: { not: driverId } },
      select: { email: true, displayName: true },
    });
    if (other) {
      throw new BadRequestException(
        `This team already has a driver (${other.displayName ?? other.email}) — remove them from the team first`,
      );
    }

    return this.prisma.user.update({ where: { id: driverId }, data: { teamId } });
  }

  async unassignDriver(organizationId: string, driverId: string) {
    const driver = await this.prisma.user.findFirst({ where: { id: driverId, organizationId, role: 'DRIVER' } });
    if (!driver) throw new NotFoundException('Driver not found (must be a user with the DRIVER role)');

    return this.prisma.user.update({ where: { id: driverId }, data: { teamId: null } });
  }
}
