import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReminderStatus } from '@prisma/client';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { SnoozeReminderDto } from './dto/snooze-reminder.dto';

@Injectable()
export class VehicleRemindersService {
  constructor(private prisma: PrismaService) {}

  // Vehicle now carries its own organizationId column, so ownership is
  // checked directly instead of joining through customer.
  private async getVehicleOrThrow(organizationId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, organizationId },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  private async getReminderOrThrow(organizationId: string, id: string) {
    const reminder = await this.prisma.vehicleReminder.findFirst({
      where: { id, organizationId },
    });
    if (!reminder) throw new NotFoundException('Reminder not found');
    return reminder;
  }

  async createForVehicle(organizationId: string, vehicleId: string, dto: CreateReminderDto) {
    await this.getVehicleOrThrow(organizationId, vehicleId);
    const dueDate = new Date(dto.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('Invalid due date');
    }
    return this.prisma.vehicleReminder.create({
      data: { organizationId, vehicleId, note: dto.note.trim(), dueDate },
    });
  }

  // Org-wide list for the Reminders page. Excludes soft-deleted; keeps
  // COMPLETED ones so the page can show a completed section instead of
  // losing history entirely the moment something's checked off.
  async listForOrg(organizationId: string) {
    return this.prisma.vehicleReminder.findMany({
      where: { organizationId, status: { not: ReminderStatus.DELETED } },
      include: {
        vehicle: {
          select: {
            id: true,
            plateNumber: true,
            vehicleModel: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async complete(organizationId: string, id: string) {
    await this.getReminderOrThrow(organizationId, id);
    return this.prisma.vehicleReminder.update({
      where: { id },
      data: { status: ReminderStatus.COMPLETED, completedAt: new Date() },
    });
  }

  // Snoozing just pushes the due date out and (re-)marks it PENDING —
  // useful if you're re-snoozing something that was already completed
  // by mistake, though the normal case is snoozing a still-PENDING one.
  async snooze(organizationId: string, id: string, dto: SnoozeReminderDto) {
    await this.getReminderOrThrow(organizationId, id);
    const dueDate = new Date(dto.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('Invalid due date');
    }
    return this.prisma.vehicleReminder.update({
      where: { id },
      data: { dueDate, status: ReminderStatus.PENDING },
    });
  }

  async softDelete(organizationId: string, id: string) {
    await this.getReminderOrThrow(organizationId, id);
    return this.prisma.vehicleReminder.update({
      where: { id },
      data: { status: ReminderStatus.DELETED },
    });
  }
}