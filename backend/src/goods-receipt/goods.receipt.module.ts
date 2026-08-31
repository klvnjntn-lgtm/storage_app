import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { GoodsReceiptController } from './goods-receipt.controller';
import { GoodsReceiptService } from './goods-receipt.service';

// Adjust module names/paths above to match your actual module files —
// these mirror what PurchaseOrderService and InvoiceService depend on
// (PrismaService, StockService, TenantOwnershipService,
// DocumentNumberingService). If TenantOwnershipService and
// DocumentNumberingService live in a different shared module in your
// repo than "SharedDocumentsModule", swap the import accordingly.
@Module({
  imports: [PrismaModule, StockModule, SharedDocumentsModule],
  controllers: [GoodsReceiptController],
  providers: [GoodsReceiptService],
  exports: [GoodsReceiptService],
})
export class GoodsReceiptModule {}