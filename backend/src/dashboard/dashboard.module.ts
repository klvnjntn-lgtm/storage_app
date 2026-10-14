import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { AccountingModule } from '../accounting/accounting.module';
import { ReorderModule } from '../reorder/reorder.module';
import { BatchesModule } from '../batches/batches.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    PrismaModule,
    OrganizationModulesModule,
    AccountingModule,
    ReorderModule,
    BatchesModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
