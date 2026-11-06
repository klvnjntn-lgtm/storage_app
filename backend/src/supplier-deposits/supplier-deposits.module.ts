import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SupplierPaymentsModule } from '../accounting/supplier-payments.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { SupplierDepositsController } from './supplier-deposits.controller';
import { SupplierDepositsService } from './supplier-deposits.service';

@Module({
  imports: [PrismaModule, GuardsModule, AccountingModule, SupplierPaymentsModule, SharedDocumentsModule],
  controllers: [SupplierDepositsController],
  providers: [SupplierDepositsService],
})
export class SupplierDepositsModule {}
