import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { SupplierBillService } from './supplier-bill.service';
import type { MatchStatus } from './supplier-bill.service';
import { CreateSupplierBillDto } from './dto/supplier-bill.dto';

// What the business owes and to whom — admin-only like supplier payments.
@RequireModule(ModuleKey.INVOICE_POS)
@Roles('ADMIN')
@Controller()
export class SupplierBillController {
  constructor(private bills: SupplierBillService) {}

  @Get('supplier-bills')
  list(
    @CurrentOrg() organizationId: string,
    @Query('supplierId') supplierId?: string,
    @Query('status') status?: MatchStatus,
  ) {
    return this.bills.list(organizationId, { supplierId, status });
  }

  @Post('supplier-bills/:id/void')
  void(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.bills.void(organizationId, id);
  }

  @Get('purchase-orders/:purchaseOrderId/match')
  match(
    @CurrentOrg() organizationId: string,
    @Param('purchaseOrderId') purchaseOrderId: string,
  ) {
    return this.bills.match(organizationId, purchaseOrderId);
  }

  @Post('purchase-orders/:purchaseOrderId/bills')
  create(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('purchaseOrderId') purchaseOrderId: string,
    @Body() dto: CreateSupplierBillDto,
  ) {
    return this.bills.create(organizationId, user.sub, purchaseOrderId, dto);
  }
}
