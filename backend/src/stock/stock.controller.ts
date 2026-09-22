import { Controller, Get, Post, Body, Param, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { StockService, ImportMode } from './stock.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentOrg } from 'src/auth/decorators/current-org.decorator';
import { OrgGuard } from 'src/auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get(':productId')
  getStock(
    @CurrentOrg() orgId: string,
    @Param('productId') productId: string,
  ) {
    return this.stockService.get(orgId, productId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('import')
  importStock(
    @Req() req,
    @CurrentOrg() orgId: string,
    @Body()
    body: {
      mode: ImportMode;
      rows: {
        sku: string;
        name: string;
        category: string;
        brand?: string;
        location: string;
        qty: number;
        sellingPrice?: number;
        costPrice?: number;
      }[];
    },
  ) {
    const { sub: userId } = req.user;

    if (!Object.values(ImportMode).includes(body.mode)) {
      throw new BadRequestException(
        `mode must be one of: ${Object.values(ImportMode).join(', ')}`,
      );
    }

    return this.stockService.import(orgId, userId, body.mode, body.rows);
  }

  // NOTE: there is deliberately no POST /stock/increase or /stock/decrease
  // endpoint. Stock movements always need an EventType + audit context to
  // be meaningful (see StockService.increase()/decrease()), and every
  // legitimate movement path already has a home that can supply one:
  //   - manual correction  → POST /stock/adjust (reason, ADJUSTMENT)
  //   - a sale             → InvoiceService.issue() (SALE, invoiceId, shared tx)
  //   - a purchase receipt → GoodsReceiptService.receive() (RECEIVE, goodsReceiptId)
  //   - import              → POST /stock/import (IMPORT_REPLACE/INCREMENT)
  //   - receive/pick/pack/ship/move/returns → the Session/fulfillment flow
  // A generic HTTP increase/decrease with no caller-supplied context
  // (previously exposed here with no userId, no Event row, and no role
  // gate — any authenticated org member could silently create stock with
  // zero audit trail) doesn't fit any of those, so neither is exposed
  // here. If a new legitimate use case shows up, add a purpose-built
  // endpoint with its own EventType and required justification — don't
  // resurrect this one as a catch-all.

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('adjust')
  async adjust(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: AdjustStockDto) {
  const { sub: userId } = req.user;
    return this.stockService.adjust(organizationId, userId, dto);
  }
}