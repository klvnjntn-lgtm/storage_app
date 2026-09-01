import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { DeliveryOrderService } from './delivery-order.service';
import { DeliveryOrderController } from './delivery-order.controller';
import { StockModule } from 'src/stock/stock.module';
import { PrintModule } from 'src/common/print/print.module';
import { OrganizationModulesModule } from 'src/organization-module/organization-modules.module';

@Module({
  imports: [PrismaModule, SharedDocumentsModule, SalesOrderModule, StockModule, PrintModule, OrganizationModulesModule],
  controllers: [DeliveryOrderController],
  providers: [DeliveryOrderService],
  exports: [DeliveryOrderService],
})
export class DeliveryOrderModule {}