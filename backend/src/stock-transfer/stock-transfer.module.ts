import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { AccountingModule } from '../accounting/accounting.module';
import { StockTransferController } from './stock-transfer.controller';
import { StockTransferService } from './stock-transfer.service';

@Module({
  imports: [PrismaModule, StockModule, SharedDocumentsModule, AccountingModule],
  controllers: [StockTransferController],
  providers: [StockTransferService],
})
export class StockTransferModule {}
