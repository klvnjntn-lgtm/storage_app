import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { StockService } from './stock.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentOrg } from 'src/auth/decorators/org.decorator';
import { OrgGuard } from 'src/auth/guards/org.guard';

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

  @Post('import')
  importStock(
    @Req() req,                           // ← add this
    @CurrentOrg() orgId: string,
    @Body()
    body: {
      rows: {
        sku: string;
        name: string;
        category: string;
        brand?: string;
        location: string;
        qty: number;
      }[];
    },
  ) {
    const { userid } = req.user;          // ← extract userid
    return this.stockService.import(orgId, userid, body.rows);
  }

  @Post('increase')
  increase(
    @CurrentOrg() orgId: string,
    @Body() body: { productId: string; locationId: string; qty: number },
  ) {
    return this.stockService.increase(orgId, body.productId, body.locationId, body.qty);
  }

  @Post('decrease')
  decrease(
    @CurrentOrg() orgId: string,
    @Body() body: { productId: string; locationId: string; qty: number },
  ) {
    return this.stockService.decrease(orgId, body.productId, body.locationId, body.qty);
  }

  @Post('adjust')
  async adjust(@Req() req, @Body() dto: AdjustStockDto) {
    const { organizationId, userid } = req.user;
    return this.stockService.adjust(organizationId, userid, dto);
  }
}