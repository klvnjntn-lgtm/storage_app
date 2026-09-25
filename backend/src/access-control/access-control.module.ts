import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessControlService } from './access-control.service';
import { AccessControlController } from './access-control.controller';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule], // skip if already registered globally elsewhere
  controllers: [AccessControlController],
  providers: [AccessControlService],
})
export class AccessControlModule {}
