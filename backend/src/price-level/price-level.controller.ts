import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PriceLevelService } from './price-level.service';
import { CreatePriceLevelDto, UpdatePriceLevelDto } from './dto/price-level.dto';

// Organization-wide price levels (Retail, Wholesale, …). Everyone selling
// can read them; only admins manage them (Settings).
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('organization/price-levels')
export class PriceLevelController {
  constructor(private readonly priceLevels: PriceLevelService) {}

  @Get()
  list(@CurrentOrg() orgId: string, @Query('includeArchived') includeArchived?: string) {
    return this.priceLevels.list(orgId, includeArchived === 'true');
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post()
  create(@CurrentOrg() orgId: string, @Body() dto: CreatePriceLevelDto) {
    return this.priceLevels.create(orgId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':id')
  update(@CurrentOrg() orgId: string, @Param('id') id: string, @Body() dto: UpdatePriceLevelDto) {
    return this.priceLevels.update(orgId, id, dto);
  }
}
