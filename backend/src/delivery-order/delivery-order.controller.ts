import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { DeliveryOrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { DeliveryOrderService } from './delivery-order.service';
import { CreateDeliveryOrderDto } from './dto/delivery-order.dto';
import { RecordDeliveryOrderReturnDto } from './dto/delivery-order-return.dto';

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('delivery-orders')
export class DeliveryOrderController {
  constructor(private deliveryOrderService: DeliveryOrderService) {}

  @Post()
  create(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateDeliveryOrderDto) {
    return this.deliveryOrderService.create(organizationId, req.user.sub, dto);
  }

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('salesOrderId') salesOrderId?: string,
    @Query('status') status?: DeliveryOrderStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.deliveryOrderService.list(organizationId, {
      salesOrderId, status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  getOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.deliveryOrderService.getOne(organizationId, id);
  }

  @Post(':id/ship')
  ship(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.deliveryOrderService.ship(organizationId, id, req.user.sub);
  }

  @Post(':id/return')
  recordReturn(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @Body() dto: RecordDeliveryOrderReturnDto,
  ) {
    return this.deliveryOrderService.recordReturn(organizationId, id, req.user.sub, dto.items, dto.reason);
  }

  @Post(':id/cancel')
  cancel(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.deliveryOrderService.cancel(organizationId, id, req.user.sub);
  }

  @Post('from-invoice/:invoiceId')
  createFromInvoice(@CurrentOrg() organizationId: string, @Param('invoiceId') invoiceId: string, @Req() req) {
    return this.deliveryOrderService.createFromInvoice(organizationId, req.user.sub, invoiceId);
  }
}