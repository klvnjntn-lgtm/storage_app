import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BankReconciliationController } from './bank-reconciliation.controller';
import { BankReconciliationService } from './bank-reconciliation.service';

@Module({
  imports: [PrismaModule, GuardsModule, AccountingModule],
  controllers: [BankReconciliationController],
  providers: [BankReconciliationService],
})
export class BankReconciliationModule {}
