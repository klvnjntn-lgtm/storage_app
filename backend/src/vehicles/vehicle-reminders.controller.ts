import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { VehicleRemindersService } from './vehicle-reminders.service';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { SnoozeReminderDto } from './dto/snooze-reminder.dto';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.WORKSHOP_RMS)
@Controller()
export class VehicleRemindersController {
  constructor(private readonly remindersService: VehicleRemindersService) {}

  @Post('vehicles/:vehicleId/reminders')
  create(@CurrentOrg() orgId: string, @Param('vehicleId') vehicleId: string, @Body() dto: CreateReminderDto) {
    return this.remindersService.createForVehicle(orgId, vehicleId, dto);
  }

  @Get('reminders')
  list(@CurrentOrg() orgId: string) {
    return this.remindersService.listForOrg(orgId);
  }

  @Patch('reminders/:id/complete')
  complete(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.remindersService.complete(orgId, id);
  }

  @Patch('reminders/:id/snooze')
  snooze(@CurrentOrg() orgId: string, @Param('id') id: string, @Body() dto: SnoozeReminderDto) {
    return this.remindersService.snooze(orgId, id, dto);
  }

  @Delete('reminders/:id')
  remove(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.remindersService.softDelete(orgId, id);
  }
}