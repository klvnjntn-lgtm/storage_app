import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { AccountingModule } from './accounting.module';
import { AmortizationsService } from './amortizations.service';
import { AmortizationsController } from './amortizations.controller';

@Module({
  imports: [PrismaModule, GuardsModule, OrganizationModulesModule, AccountingModule],
  controllers: [AmortizationsController],
  providers: [AmortizationsService],
  exports: [AmortizationsService],
})
export class AmortizationsModule {}
