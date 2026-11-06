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
import { SupplierDepositsService } from './supplier-deposits.service';

class CreateSupplierDepositDto {
  @IsString()
  supplierId: string;

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

class ApplySupplierDepositDto {
  @IsString()
  purchaseOrderId: string;

  // Left out: as much as both sides allow.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;
}

class RefundSupplierDepositDto {
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

class VoidSupplierDepositDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

// Money going out: admin-only, reads included, like supplier payments.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard, RolesGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Roles('ADMIN')
@Controller('supplier-deposits')
export class SupplierDepositsController {
  constructor(private readonly deposits: SupplierDepositsService) {}

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Query('branchId') branchId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('open') open?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.deposits.list(organizationId, {
      branchId: filterBranchId(req.user, branchId),
      supplierId,
      open: open === 'true',
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('for-purchase-order/:purchaseOrderId')
  forPurchaseOrder(@CurrentOrg() organizationId: string, @Req() req, @Param('purchaseOrderId') purchaseOrderId: string) {
    return this.deposits.openForPurchaseOrder(organizationId, purchaseOrderId, scopedBranchId(req.user) ?? undefined);
  }

  @Post()
  create(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateSupplierDepositDto) {
    return this.deposits.create(organizationId, { ...dto, branchId: bookingBranchId(req.user, dto.branchId) }, req.user.sub);
  }

  @Post(':id/apply')
  apply(@CurrentOrg() organizationId: string, @Req() req, @Param('id') id: string, @Body() dto: ApplySupplierDepositDto) {
    return this.deposits.apply(organizationId, id, dto.purchaseOrderId, dto.amount, req.user.sub, scopedBranchId(req.user) ?? undefined);
  }

  @Post(':id/refund')
  refund(@CurrentOrg() organizationId: string, @Req() req, @Param('id') id: string, @Body() dto: RefundSupplierDepositDto) {
    return this.deposits.refund(organizationId, id, dto, req.user.sub, scopedBranchId(req.user) ?? undefined);
  }

  @Post(':id/void')
  voidDeposit(@CurrentOrg() organizationId: string, @Req() req, @Param('id') id: string, @Body() dto: VoidSupplierDepositDto) {
    return this.deposits.voidDeposit(organizationId, id, dto.reason, req.user.sub, scopedBranchId(req.user) ?? undefined);
  }
}
