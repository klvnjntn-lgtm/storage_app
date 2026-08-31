// src/warehouse/warehouse.controller.ts
import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModuleKey } from '@prisma/client';

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @UseGuards(ModuleGuard)
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Post('receive')
  receive(
    @CurrentOrg() organizationId: string,
    @Body() body: { productId: string; qty: number; locationId?: string },
  ) {
    return this.warehouseService.receive(organizationId, body.productId, body.qty, body.locationId);
  }

  @UseGuards(ModuleGuard)
  @RequireModule(ModuleKey.WAREHOUSE_OPS)
  @Post('move')
  move(
    @CurrentOrg() organizationId: string,
    @Body()
    body: { productId: string; qty: number; fromLocationId: string; toLocationId: string },
  ) {
    return this.warehouseService.move(organizationId, body.productId, body.qty, body.fromLocationId, body.toLocationId);
  }

  // Read-only, ungated — same reasoning as ProductController/SessionsController.
  @Get('events')
  events(@CurrentOrg() organizationId: string) {
    return this.warehouseService.events(organizationId);
  }
}