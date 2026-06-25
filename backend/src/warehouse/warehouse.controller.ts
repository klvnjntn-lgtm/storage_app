import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from 'src/auth/guards/org.guard';
import { CurrentOrg } from 'src/auth/decorators/org.decorator';

/**
 * JwtAuthGuard  — validates the JWT and populates req.user
 * OrgGuard      — confirms the organizationId in the token is real
 *
 * Both run on every route in this controller.
 */
@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get('summary')
  summary(@CurrentOrg() orgId: string) {
    return this.warehouseService.summary(orgId);
  }

  @Get('events')
  events(@CurrentOrg() orgId: string) {
    return this.warehouseService.events(orgId);
  }

  @Post('receive')
  receive(
    @CurrentOrg() orgId: string,
    @Body() body: { productId: string; qty: number; locationId?: string },
  ) {
    return this.warehouseService.receive(
      orgId,
      body.productId,
      body.qty,
      body.locationId,
    );
  }

  @Post('move')
  move(
    @CurrentOrg() orgId: string,
    @Body()
    body: {
      productId: string;
      qty: number;
      fromLocationId: string;
      toLocationId: string;
    },
  ) {
    return this.warehouseService.move(
      orgId,
      body.productId,
      body.qty,
      body.fromLocationId,
      body.toLocationId,
    );
  }
}