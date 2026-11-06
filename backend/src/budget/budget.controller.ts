import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { filterBranchId } from '../auth/branch-scope';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BudgetService } from './budget.service';

class BudgetRowDto {
  @IsString()
  accountId: string;

  @IsArray()
  @IsNumber({}, { each: true })
  budget: number[];
}

class SaveBudgetDto {
  @IsInt()
  year: number;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BudgetRowDto)
  rows: BudgetRowDto[];
}

// Part of the books, so MASTER only.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard, RolesGuard)
@Roles('MASTER')
@RequireModule(ModuleKey.ACCOUNTING)
@Controller('budgets')
export class BudgetController {
  constructor(private readonly budgets: BudgetService) {}

  @Get()
  get(@CurrentOrg() organizationId: string, @Req() req, @Query('year') year: string, @Query('branchId') branchId?: string) {
    return this.budgets.get(organizationId, Number(year), filterBranchId(req.user, branchId));
  }

  @Put()
  save(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: SaveBudgetDto) {
    return this.budgets.save(organizationId, dto.year, filterBranchId(req.user, dto.branchId), dto.rows);
  }
}
