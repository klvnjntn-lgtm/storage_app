import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { AccountingModule } from '../accounting/accounting.module';
import { GoodsReceiptController } from './goods-receipt.controller';
import { GoodsReceiptService } from './goods-receipt.service';

// Receiving stock against a purchase order: adds the stock, moves the PO to
// PARTIALLY/FULLY_RECEIVED, and posts Inventory/AP — the AP that supplier
// payments are then made against.
@Module({
  imports: [PrismaModule, StockModule, SharedDocumentsModule, AccountingModule],
  controllers: [GoodsReceiptController],
  providers: [GoodsReceiptService],
  exports: [GoodsReceiptService],
})
export class GoodsReceiptModule {}
