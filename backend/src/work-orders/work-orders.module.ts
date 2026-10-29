import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { SalesQuotationModule } from '../sales-quotation/sales-quotation.module';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { WorkOrdersController } from './work-orders.controller';
import { MechanicsController } from './mechanics.controller';
import { WorkOrdersService } from './work-orders.service';

@Module({
  imports: [PrismaModule, GuardsModule, SharedDocumentsModule, InvoiceModule, SalesQuotationModule, OrganizationModulesModule],
  controllers: [WorkOrdersController, MechanicsController],
  providers: [WorkOrdersService],
})
export class WorkOrdersModule {}
