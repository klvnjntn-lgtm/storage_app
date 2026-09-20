import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ExpenseStatus, ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpensesService } from './expenses.service';
import { CreateExpenseCategoryDto, CreateExpenseDto, MarkExpensePaidDto, UpdateExpenseCategoryDto } from './dto/expense.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('expenses')
export class ExpensesController {
  constructor(
    private categoriesService: ExpenseCategoriesService,
    private expensesService: ExpensesService,
  ) {}

  // --- Categories ---

  @Get('categories')
  listCategories(@CurrentOrg() organizationId: string) {
    return this.categoriesService.list(organizationId);
  }

  @Post('categories')
  createCategory(@CurrentOrg() organizationId: string, @Body() dto: CreateExpenseCategoryDto) {
    return this.categoriesService.create(organizationId, dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    return this.categoriesService.update(organizationId, id, dto);
  }

  // --- Expenses ---

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('status') status?: ExpenseStatus,
    @Query('categoryId') categoryId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.expensesService.list(organizationId, {
      status,
      categoryId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  get(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.expensesService.get(organizationId, id);
  }

  @Post()
  create(@CurrentOrg() organizationId: string, @Body() dto: CreateExpenseDto) {
    return this.expensesService.create(organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { description?: string; dueDate?: string; locationId?: string },
  ) {
    return this.expensesService.update(organizationId, id, dto);
  }

  @Post(':id/mark-paid')
  markPaid(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkExpensePaidDto,
  ) {
    return this.expensesService.markPaid(organizationId, id, dto);
  }

  @Delete(':id')
  voidUnpaid(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
    @Body('reason') reason?: string,
  ) {
    return this.expensesService.voidUnpaid(organizationId, id, req.user.sub, reason);
  }
}