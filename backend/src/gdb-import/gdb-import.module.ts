import { Module } from '@nestjs/common';
import { GdbImportController } from './gdb-import.controller';
import { GdbImportService } from './gdb-import.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LocationModule } from 'src/location/location.module';
import { PlanLimitsModule } from '../billing/plan-limits.module';

@Module({
  imports: [PrismaModule, LocationModule, PlanLimitsModule], // matches how IntegrationService pulls in PrismaModule
  controllers: [GdbImportController],
  providers: [GdbImportService,],
})
export class GdbImportModule {}