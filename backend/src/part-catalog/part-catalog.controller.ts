import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { PartCatalogService } from './part-catalog.service';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';

const ORIGINS = new Set(['Official', 'Aftermarket', 'Unknown']);

// Read-only. The catalogue is shared across orgs and written only by the scraper's sync,
// so there are no create/update routes; the org only matters for the "in your stock" match.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.WORKSHOP_RMS)
@Controller('part-catalog')
export class PartCatalogController {
  constructor(private readonly partCatalogService: PartCatalogService) {}

  @Get('facets')
  facets() {
    return this.partCatalogService.facets();
  }

  // EPC-style summary for one car: per item what to use, alternatives, confidence and stock.
  @Get('vehicle')
  vehicle(
    @CurrentOrg() orgId: string,
    @Query('brand') brand?: string,
    @Query('model') model?: string,
    @Query('year') year?: string,
  ) {
    if (!brand || !model)
      throw new BadRequestException('brand and model are required');
    const yearNum = Number(year);
    return this.partCatalogService.vehicleSummary(
      orgId,
      brand,
      model,
      Number.isInteger(yearNum) && yearNum > 1900 ? yearNum : undefined,
    );
  }

  // One part number: which cars it fits, equivalents and stock.
  @Get('oem/:oem')
  partNumber(@CurrentOrg() orgId: string, @Param('oem') oem: string) {
    return this.partCatalogService.partNumber(orgId, oem.slice(0, 40));
  }

  @Get()
  search(
    @CurrentOrg() orgId: string,
    @Query('brand') brand?: string,
    @Query('model') model?: string,
    @Query('year') year?: string,
    @Query('itemType') itemType?: string,
    @Query('item') item?: string,
    @Query('origin') origin?: string,
    @Query('spec') spec?: string,
    @Query('minSellers') minSellers?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const yearNum = Number(year);
    return this.partCatalogService.search(orgId, {
      brand: brand || undefined,
      model: model || undefined,
      year: Number.isInteger(yearNum) && yearNum > 1900 ? yearNum : undefined,
      itemType: itemType || undefined,
      item: item || undefined,
      origin: origin && ORIGINS.has(origin) ? origin : undefined,
      spec: spec?.slice(0, 50) || undefined,
      // Default 2: a fitment needs two different shops agreeing before it's shown.
      minSellers: Math.min(10, Math.max(1, Number(minSellers) || 2)),
      q: q?.slice(0, 100) || undefined,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(100, Math.max(1, Number(limit) || 25)),
    });
  }
}
