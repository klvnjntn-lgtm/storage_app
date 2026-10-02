import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { StockModule } from '../stock/stock.module';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { SalesQuotationModule } from '../sales-quotation/sales-quotation.module';
import { SalesOrderService } from './sales-order.service';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderPrintController } from './sales-order-print.controller';
import { PrintModule } from 'src/common/print/print.module';

@Module({
  imports: [
    PrismaModule,
    SharedDocumentsModule,
    StockModule,
    OrganizationModulesModule,
    SalesQuotationModule,
    PrintModule, // ← import the module instead of listing the service
  ],
  // The print controller was never registered here, so Puppeteer's
  // GET /print/sales-orders/:id 404'd and every sales-order PDF was blank.
  controllers: [SalesOrderController, SalesOrderPrintController],
  providers: [SalesOrderService], // ← remove PrintTokenService from here
  exports: [SalesOrderService],
})
export class SalesOrderModule {}