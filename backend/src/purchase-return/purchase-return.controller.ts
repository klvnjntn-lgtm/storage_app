import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { PurchaseReturnService } from './purchase-return.service';
import { CreatePurchaseReturnDto } from './dto/purchase-return.dto';

@RequireModule(ModuleKey.INVOICE_POS)
@Controller()
export class PurchaseReturnController {
  constructor(private returns: PurchaseReturnService) {}

  @Get('purchase-returns')
  list(
    @CurrentOrg() organizationId: string,
    @Query('purchaseOrderId') purchaseOrderId?: string,
  ) {
    return this.returns.list(organizationId, purchaseOrderId);
  }

  @Get('purchase-orders/:purchaseOrderId/returnable')
  returnable(
    @CurrentOrg() organizationId: string,
    @Param('purchaseOrderId') purchaseOrderId: string,
  ) {
    return this.returns.returnable(organizationId, purchaseOrderId);
  }

  @Post('purchase-orders/:purchaseOrderId/returns')
  create(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('purchaseOrderId') purchaseOrderId: string,
    @Body() dto: CreatePurchaseReturnDto,
  ) {
    return this.returns.create(organizationId, user.sub, purchaseOrderId, dto);
  }
}
