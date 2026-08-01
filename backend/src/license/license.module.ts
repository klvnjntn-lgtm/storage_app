import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LicenseService } from './license.service';
import { LicenseController } from './license.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule], // skip if you already register this globally elsewhere
  controllers: [LicenseController],
  providers: [LicenseService],
  exports: [LicenseService],
})
export class LicenseModule {}