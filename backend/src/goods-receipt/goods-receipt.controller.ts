import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { GoodsReceiptService } from './goods-receipt.service';
import { ReceiveGoodsDto } from './dto/goods-receipt.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('purchase-orders/:purchaseOrderId')
export class GoodsReceiptController {
  constructor(private goodsReceiptService: GoodsReceiptService) {}

  @Get('receiving-summary')
  getReceivingSummary(@CurrentOrg() organizationId: string, @Param('purchaseOrderId') purchaseOrderId: string) {
    return this.goodsReceiptService.getReceivingSummary(organizationId, purchaseOrderId);
  }

  @Post('receive')
  receive(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Param('purchaseOrderId') purchaseOrderId: string,
    @Body() dto: ReceiveGoodsDto,
  ) {
    return this.goodsReceiptService.receive(organizationId, req.user.sub, purchaseOrderId, dto);
  }

  @Get('receipts')
  listReceipts(@CurrentOrg() organizationId: string, @Param('purchaseOrderId') purchaseOrderId: string) {
    return this.goodsReceiptService.listReceipts(organizationId, purchaseOrderId);
  }
}