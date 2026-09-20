
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { SupplierPaymentsService } from './supplier-payments.service';
import { CreateSupplierPaymentDto } from './dto/supplier-payment.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('supplier-payments')
export class SupplierPaymentsController {
  constructor(private supplierPaymentsService: SupplierPaymentsService) {}

  @Get()
  list(@CurrentOrg() organizationId: string, @Query('purchaseOrderId') purchaseOrderId?: string) {
    return this.supplierPaymentsService.list(organizationId, purchaseOrderId);
  }

  @Get('outstanding/:purchaseOrderId')
  async getOutstanding(
    @CurrentOrg() organizationId: string,
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
  ) {
    const outstanding = await this.supplierPaymentsService.getOutstanding(organizationId, purchaseOrderId);
    return { purchaseOrderId, outstanding };
  }

  @Get(':id')
  get(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.supplierPaymentsService.get(organizationId, id);
  }

  @Post()
  create(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateSupplierPaymentDto) {
    return this.supplierPaymentsService.create(organizationId, req.user.sub, dto);
  }

  @Delete(':id')
  void(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
    @Body('reason') reason?: string,
  ) {
    return this.supplierPaymentsService.void(organizationId, id, req.user.sub, reason);
  }
}