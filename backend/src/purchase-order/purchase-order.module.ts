import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { PrintModule } from 'src/common/print/print.module';
import { PurchaseOrderPrintController } from './purchase-order-print.controller';
import { ProductModule } from 'src/product/product.module';

@Module({
  imports: [PrismaModule, SharedDocumentsModule, PrintModule, ProductModule],
  controllers: [PurchaseOrderController, PurchaseOrderPrintController],
  providers: [PurchaseOrderService],
  exports: [PurchaseOrderService],
})
export class PurchaseOrderModule {}