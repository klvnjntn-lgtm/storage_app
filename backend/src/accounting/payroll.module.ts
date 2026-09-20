import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { AccountingModule } from '../accounting/accounting.module';
import { EmployeesService } from './employees.service';
import { SalaryComponentsService } from './salary-components.service';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';

@Module({
  imports: [PrismaModule, GuardsModule, OrganizationModulesModule, AccountingModule],
  controllers: [PayrollController],
  providers: [EmployeesService, SalaryComponentsService, PayrollService],
  exports: [EmployeesService, SalaryComponentsService, PayrollService],
})
export class PayrollModule {}