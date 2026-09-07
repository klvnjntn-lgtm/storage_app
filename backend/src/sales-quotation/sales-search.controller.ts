// sales-search.controller.ts

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { SalesSearchService, SalesSearchResultType } from './sales-search.service';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';

const VALID_TYPES: SalesSearchResultType[] = ['QUOTATION', 'ORDER', 'INVOICE', 'DELIVERY_ORDER'];

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('sales/search')
export class SalesSearchController {
  constructor(private salesSearchService: SalesSearchService) {}

  @Get()
  search(
    @CurrentOrg() orgId: string,
    @Query('q') q = '',
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('type') type?: string,
  ) {
    const parsedPage = Math.max(1, Number(page) || 1);
    const parsedLimit = Math.max(1, Number(limit) || 20);
    const parsedType = VALID_TYPES.includes(type as SalesSearchResultType)
      ? (type as SalesSearchResultType)
      : undefined;

    return this.salesSearchService.search(orgId, q, parsedPage, parsedLimit, parsedType);
  }
}