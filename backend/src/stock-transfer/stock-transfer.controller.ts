import {
  Body,
  Controller,
  Get,
  Optional,
  Param,
  ParseEnumPipe,
  Post,
  Query,
} from '@nestjs/common';
import { WebhooksService } from '../api-access/webhooks.service';
import { ModuleKey, StockTransferStatus } from '@prisma/client';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { StockTransferService } from './stock-transfer.service';
import {
  CreateStockTransferDto,
  ReceiveStockTransferDto,
} from './dto/stock-transfer.dto';

@RequireModule(ModuleKey.WAREHOUSE_OPS, ModuleKey.INVOICE_POS)
@Controller('stock-transfers')
export class StockTransferController {
  constructor(
    private transfers: StockTransferService,
    @Optional() private webhooks?: WebhooksService,
  ) {}

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('status', new ParseEnumPipe(StockTransferStatus, { optional: true }))
    status?: StockTransferStatus,
  ) {
    return this.transfers.list(organizationId, status);
  }

  @Get(':id')
  get(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.transfers.get(organizationId, id);
  }

  @Post()
  async create(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStockTransferDto,
  ) {
    const transfer = await this.transfers.create(organizationId, user.sub, dto);
    // A quick move arrives as it's saved.
    if (transfer.quickMove) this.emitReceived(organizationId, transfer);
    return transfer;
  }

  @Post(':id/ship')
  ship(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.transfers.ship(organizationId, id, user.sub);
  }

  @Post(':id/receive')
  async receive(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReceiveStockTransferDto,
  ) {
    const transfer = await this.transfers.receive(
      organizationId,
      id,
      user.sub,
      dto,
    );
    this.emitReceived(organizationId, transfer);
    return transfer;
  }

  private emitReceived(
    organizationId: string,
    transfer: Awaited<ReturnType<StockTransferService['receive']>>,
  ) {
    void this.webhooks?.emit(organizationId, 'stock_transfer.received', {
      id: transfer.id,
      transferNumber: transfer.transferNumber,
      quickMove: transfer.quickMove,
      fromLocationId: transfer.fromLocationId,
      toLocationId: transfer.toLocationId,
      items: transfer.items.map((i) => ({
        productId: i.productId,
        quantity: Number(i.quantity),
        received: Number(i.receivedQuantity),
      })),
    });
  }

  @Post(':id/cancel')
  cancel(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.transfers.cancel(organizationId, id, user.sub);
  }
}
