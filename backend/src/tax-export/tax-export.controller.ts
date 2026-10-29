import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ModuleKey } from '@prisma/client';
import { IsBoolean, IsOptional, Matches } from 'class-validator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { TaxExportService } from './tax-export.service';

class CoretaxExportDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;

  @IsOptional()
  @IsBoolean()
  includeExported?: boolean;
}

// Tax filings are an admin job, same as the rest of accounting.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard, RolesGuard)
// Exports every branch's invoices, so MASTER only.
@Roles('MASTER')
@RequireModule(ModuleKey.ACCOUNTING)
@Controller('tax-export')
export class TaxExportController {
  constructor(private readonly taxExport: TaxExportService) {}

  @Get('coretax/preview')
  preview(
    @CurrentOrg() orgId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('includeExported') includeExported?: string,
  ) {
    return this.taxExport.preview(orgId, from ?? '', to ?? '', includeExported === 'true');
  }

  // POST, not GET: it stamps the exported invoices.
  @Post('coretax')
  async export(@CurrentOrg() orgId: string, @Body() dto: CoretaxExportDto, @Res() res: Response) {
    const { xml, count } = await this.taxExport.export(orgId, dto.from, dto.to, !!dto.includeExported);
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="faktur-keluaran-${dto.from}_${dto.to}.xml"`,
      'X-Faktur-Count': String(count),
      'Access-Control-Expose-Headers': 'X-Faktur-Count, Content-Disposition',
    });
    res.send(xml);
  }
}
