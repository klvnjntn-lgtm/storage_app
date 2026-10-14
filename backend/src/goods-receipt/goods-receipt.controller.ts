import { Body, Controller, Get, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { WebhooksService } from '../api-access/webhooks.service';
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
  constructor(
    private goodsReceiptService: GoodsReceiptService,
    @Optional() private webhooks?: WebhooksService,
  ) {}

  @Get('receiving-summary')
  getReceivingSummary(@CurrentOrg() organizationId: string, @Param('purchaseOrderId') purchaseOrderId: string) {
    return this.goodsReceiptService.getReceivingSummary(organizationId, purchaseOrderId);
  }

  @Post('receive')
  async receive(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Param('purchaseOrderId') purchaseOrderId: string,
    @Body() dto: ReceiveGoodsDto,
  ) {
    const receipt = await this.goodsReceiptService.receive(organizationId, req.user.sub, purchaseOrderId, dto);
    void this.webhooks?.emit(organizationId, 'goods_receipt.created', {
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      purchaseOrderId,
      locationId: dto.locationId,
      items: receipt.items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })),
      purchaseOrderStatus: receipt.purchaseOrderStatus,
    });
    return receipt;
  }

  @Get('receipts')
  listReceipts(@CurrentOrg() organizationId: string, @Param('purchaseOrderId') purchaseOrderId: string) {
    return this.goodsReceiptService.listReceipts(organizationId, purchaseOrderId);
  }
}