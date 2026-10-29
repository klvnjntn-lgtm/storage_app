import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BankAccountService } from './bank-account.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-accounts.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
// Every bank account is a ledger account in the business-wide books (Chart of Accounts → 1010 Bank), so
// only MASTER sets them up; anyone may list them, to pick one on a document.
@Controller('organization/bank-accounts')
export class BankAccountController {
  constructor(private readonly bankAccounts: BankAccountService) {}

  @Get()
  list(
    @CurrentOrg() orgId: string,
    @Req() req,
    @Query('includeArchived') includeArchived?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.bankAccounts.list(orgId, includeArchived === 'true', req.user, branchId);
  }

  @UseGuards(RolesGuard)
  @Roles('MASTER')
  @Post()
  create(@CurrentOrg() orgId: string, @Body() dto: CreateBankAccountDto, @Req() req) {
    return this.bankAccounts.create(orgId, dto, req.user);
  }

  @UseGuards(RolesGuard)
  @Roles('MASTER')
  @Patch(':id')
  update(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
    @Req() req,
  ) {
    return this.bankAccounts.update(orgId, id, dto, req.user);
  }

  @UseGuards(RolesGuard)
  @Roles('MASTER')
  @Delete(':id')
  archive(@CurrentOrg() orgId: string, @Param('id') id: string, @Req() req) {
    return this.bankAccounts.archive(orgId, id, req.user);
  }

  @UseGuards(RolesGuard)
  @Roles('MASTER')
  @Post(':id/restore')
  restore(@CurrentOrg() orgId: string, @Param('id') id: string, @Req() req) {
    return this.bankAccounts.restore(orgId, id, req.user);
  }
}