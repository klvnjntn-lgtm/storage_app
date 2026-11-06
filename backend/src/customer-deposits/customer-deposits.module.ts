import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { PaymentsModule } from '../payments/payment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { CustomerDepositsController } from './customer-deposits.controller';
import { CustomerDepositsService } from './customer-deposits.service';

@Module({
  imports: [PrismaModule, GuardsModule, AccountingModule, PaymentsModule, SharedDocumentsModule],
  controllers: [CustomerDepositsController],
  providers: [CustomerDepositsService],
})
export class CustomerDepositsModule {}
