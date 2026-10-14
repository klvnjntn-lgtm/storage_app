import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PurchaseReturnController } from './purchase-return.controller';
import { PurchaseReturnService } from './purchase-return.service';

@Module({
  imports: [PrismaModule, StockModule, SharedDocumentsModule, AccountingModule],
  controllers: [PurchaseReturnController],
  providers: [PurchaseReturnService],
  exports: [PurchaseReturnService],
})
export class PurchaseReturnModule {}
