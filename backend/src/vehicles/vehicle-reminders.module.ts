import { Module } from '@nestjs/common';
import { VehicleRemindersService } from './vehicle-reminders.service';
import { VehicleRemindersController } from './vehicle-reminders.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VehicleRemindersController],
  providers: [VehicleRemindersService],
})
export class VehicleRemindersModule {}