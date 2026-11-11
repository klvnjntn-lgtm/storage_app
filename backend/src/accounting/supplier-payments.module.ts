import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { AccountingModule } from '../accounting/accounting.module';
import { SupplierPaymentsService } from './supplier-payments.service';
import { SupplierPaymentsController } from './supplier-payments.controller';
import { SettlementsController } from './settlements.controller';

@Module({
  imports: [PrismaModule, GuardsModule, OrganizationModulesModule, AccountingModule],
  controllers: [SupplierPaymentsController, SettlementsController],
  providers: [SupplierPaymentsService],
  exports: [SupplierPaymentsService],
})
export class SupplierPaymentsModule {}