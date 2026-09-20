import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { EmployeesService } from './employees.service';
import { SalaryComponentsService } from './salary-components.service';
import { PayrollService } from './payroll.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import {
  CreateSalaryComponentTypeDto,
  SetEmployeeComponentsDto,
  UpdateSalaryComponentTypeDto,
} from './dto/salary-component.dto';
import { CreatePayrollDto, MarkPayrollPaidDto } from './dto/payroll.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('payroll')
export class PayrollController {
  constructor(
    private employeesService: EmployeesService,
    private componentsService: SalaryComponentsService,
    private payrollService: PayrollService,
  ) {}

  // --- Employees ---

  @Get('employees')
  listEmployees(@CurrentOrg() organizationId: string, @Query('includeArchived') includeArchived?: string) {
    return this.employeesService.list(organizationId, includeArchived === 'true');
  }

  @Get('employees/:id')
  getEmployee(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.employeesService.get(organizationId, id);
  }

  @Post('employees')
  createEmployee(@CurrentOrg() organizationId: string, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(organizationId, dto);
  }

  @Patch('employees/:id')
  updateEmployee(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(organizationId, id, dto);
  }

  @Delete('employees/:id')
  archiveEmployee(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.employeesService.archive(organizationId, id);
  }

  @Post('employees/:id/components')
  setEmployeeComponents(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetEmployeeComponentsDto,
  ) {
    return this.employeesService.setComponents(organizationId, id, dto);
  }

  // --- Salary component types ---

  @Get('components')
  listComponents(@CurrentOrg() organizationId: string) {
    return this.componentsService.list(organizationId);
  }

  @Post('components')
  createComponent(@CurrentOrg() organizationId: string, @Body() dto: CreateSalaryComponentTypeDto) {
    return this.componentsService.create(organizationId, dto);
  }

  @Patch('components/:id')
  updateComponent(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalaryComponentTypeDto,
  ) {
    return this.componentsService.update(organizationId, id, dto);
  }

  // --- Payroll runs ---

  @Get('runs')
  listRuns(@CurrentOrg() organizationId: string) {
    return this.payrollService.list(organizationId);
  }

  @Get('runs/:id')
  getRun(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payrollService.get(organizationId, id);
  }

  @Post('runs')
  createRun(@CurrentOrg() organizationId: string, @Body() dto: CreatePayrollDto) {
    return this.payrollService.create(organizationId, dto);
  }

  @Post('runs/:id/post')
  postRun(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payrollService.post(organizationId, id);
  }

  @Post('runs/:id/mark-paid')
  markRunPaid(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPayrollPaidDto,
  ) {
    return this.payrollService.markPaid(organizationId, id, dto);
  }

  @Delete('runs/:id')
  deleteRun(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payrollService.remove(organizationId, id);
  }
}