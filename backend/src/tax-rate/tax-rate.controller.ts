import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TaxRateService } from './tax-rate.service';
import { CreateTaxRateDto, UpdateTaxRateDto, UpsertDefaultTaxRateDto } from './dto/tax-rates.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('organization/tax-rates')
export class TaxRateController {
  constructor(private readonly taxRates: TaxRateService) {}

  @Get()
  list(@CurrentOrg() orgId: string, @Query('includeArchived') includeArchived?: string) {
    return this.taxRates.list(orgId, includeArchived === 'true');
  }

  // GET /organization/tax-rates/default — Settings page's single default
  // rate. Must stay declared before GET/PATCH/DELETE :id below it, or Nest
  // will try to match "default" as an :id param instead.
  @Get('default')
  getDefault(@CurrentOrg() orgId: string) {
    return this.taxRates.getDefault(orgId);
  }

  // PUT /organization/tax-rates/default — Settings page "Save tax details".
  // Admin-only, same as the other write endpoints on this controller —
  // enforced via RolesGuard/@Roles rather than a manual req.user.role
  // check, so there's exactly one implementation of "what counts as
  // admin" across the whole app.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Put('default')
  upsertDefault(@CurrentOrg() orgId: string, @Body() dto: UpsertDefaultTaxRateDto) {
    return this.taxRates.upsertDefault(orgId, dto);
  }

  // POST /organization/tax-rates/default/disable — Settings page toggle
  // "No". Archives the default row but keeps name/percentage.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('default/disable')
  disableDefault(@CurrentOrg() orgId: string) {
    return this.taxRates.disableDefault(orgId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post()
  create(@CurrentOrg() orgId: string, @Body() dto: CreateTaxRateDto) {
    return this.taxRates.create(orgId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':id')
  update(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTaxRateDto,
  ) {
    return this.taxRates.update(orgId, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  archive(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.taxRates.archive(orgId, id);
  }
}