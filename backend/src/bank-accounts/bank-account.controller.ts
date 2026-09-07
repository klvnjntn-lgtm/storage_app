import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
@Controller('organization/bank-accounts')
export class BankAccountController {
  constructor(private readonly bankAccounts: BankAccountService) {}

  @Get()
  list(@CurrentOrg() orgId: string, @Query('includeArchived') includeArchived?: string) {
    return this.bankAccounts.list(orgId, includeArchived === 'true');
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post()
  create(@CurrentOrg() orgId: string, @Body() dto: CreateBankAccountDto) {
    return this.bankAccounts.create(orgId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':id')
  update(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.bankAccounts.update(orgId, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  archive(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.bankAccounts.archive(orgId, id);
  }
}