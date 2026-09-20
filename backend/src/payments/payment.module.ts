// payments/payment.module.ts
//
// Merge into your existing PaymentsModule — the key addition is
// AccountingModule in imports, which is what makes PostingRulesService
// injectable into PaymentService. Keep whatever other imports you
// already have (GuardsModule, OrganizationModulesModule, etc. — the
// controller's @UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard) needs
// the same ones InvoiceModule brings in).

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';

@Module({
  imports: [PrismaModule, GuardsModule, OrganizationModulesModule, AccountingModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentsModule {}