import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrganizationModulesModule } from 'src/organization-module/organization-modules.module';
import { TenantOwnershipService } from './tenant-ownership.service';
import { DocumentNumberingService } from './document-numbering.service';
import { LineItemPricingService } from './line-item-pricing.service';

@Module({
  imports: [PrismaModule, OrganizationModulesModule],
  providers: [TenantOwnershipService, DocumentNumberingService, LineItemPricingService],
  exports: [TenantOwnershipService, DocumentNumberingService, LineItemPricingService],
})
export class SharedDocumentsModule {}