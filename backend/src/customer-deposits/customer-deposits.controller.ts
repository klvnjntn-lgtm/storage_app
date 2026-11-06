import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ModuleKey, PaymentMethod } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, Matches, MaxLength } from 'class-validator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { bookingBranchId, filterBranchId, scopedBranchId } from '../auth/branch-scope';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PaymentService } from '../payments/payment.service';
import { CustomerDepositsService } from './customer-deposits.service';

class CreateDepositDto {
  @IsString()
  customerId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @IsString()
  branchId?: string;
}

class ApplyDepositDto {
  @IsString()
  invoiceId: string;

  // Left out: as much as both sides allow.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;
}

class RefundDepositDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  bankAccountId?: string;
}

class VoidDepositDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

// Same gate and roles as invoice payments: staff take and use the money;
// undoing it is an admin's job.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS, ModuleKey.WORKSHOP_RMS)
@Controller('customer-deposits')
export class CustomerDepositsController {
  constructor(
    private readonly deposits: CustomerDepositsService,
    private readonly payments: PaymentService,
  ) {}

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Query('branchId') branchId?: string,
    @Query('customerId') customerId?: string,
    @Query('open') open?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.deposits.list(organizationId, {
      branchId: filterBranchId(req.user, branchId),
      customerId,
      open: open === 'true',
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post()
  create(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateDepositDto) {
    return this.deposits.create(organizationId, { ...dto, branchId: bookingBranchId(req.user, dto.branchId) }, req.user.sub);
  }

  @Post(':id/apply')
  apply(@CurrentOrg() organizationId: string, @Req() req, @Param('id') id: string, @Body() dto: ApplyDepositDto) {
    return this.payments.applyDeposit(organizationId, dto.invoiceId, id, dto.amount, req.user.sub, scopedBranchId(req.user) ?? undefined);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post(':id/refund')
  refund(@CurrentOrg() organizationId: string, @Req() req, @Param('id') id: string, @Body() dto: RefundDepositDto) {
    return this.deposits.refund(organizationId, id, dto, req.user.sub, scopedBranchId(req.user) ?? undefined);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post(':id/void')
  voidDeposit(@CurrentOrg() organizationId: string, @Req() req, @Param('id') id: string, @Body() dto: VoidDepositDto) {
    return this.deposits.voidDeposit(organizationId, id, dto.reason, req.user.sub, scopedBranchId(req.user) ?? undefined);
  }
}
