import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { AccountingModule } from '../accounting/accounting.module';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';

@Module({
  imports: [PrismaModule, GuardsModule, OrganizationModulesModule, AccountingModule],
  controllers: [ExpensesController],
  providers: [ExpenseCategoriesService, ExpensesService],
  exports: [ExpenseCategoriesService, ExpensesService],
})
export class ExpensesModule {}