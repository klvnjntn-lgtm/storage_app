import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LicenseService } from './license.service';
import { LicenseController } from './license.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { KeygenService } from './keygen.service';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule], // skip if you already register this globally elsewhere
  controllers: [LicenseController],
  providers: [LicenseService, KeygenService],
  exports: [LicenseService],
})
export class LicenseModule {}