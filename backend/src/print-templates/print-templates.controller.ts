import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PrintDocType } from '@prisma/client';
import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { PrintTemplatesService } from './print-templates.service';
import { PAPER_SIZES } from './layout-validator';

class CreatePrintTemplateDto {
  @IsIn(Object.values(PrintDocType))
  docType: PrintDocType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsIn(PAPER_SIZES)
  paperSize: string;

  @IsObject()
  layout: Record<string, unknown>;

  @IsOptional()
  @IsString()
  branchId?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

class UpdatePrintTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(PAPER_SIZES)
  paperSize?: string;

  @IsOptional()
  @IsObject()
  layout?: Record<string, unknown>;
}

class SetDefaultDto {
  @IsBoolean()
  isDefault: boolean;
}

class DuplicateDto {
  @IsOptional()
  @IsString()
  branchId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

// Branch print designs. Everyone at a branch lists them, to pick one when
// printing; its ADMIN (and MASTER, for any branch) draws and manages them.
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('print-templates')
export class PrintTemplatesController {
  constructor(private readonly templates: PrintTemplatesService) {}

  @Roles('ADMIN', 'USER')
  @Get()
  list(
    @CurrentOrg() orgId: string,
    @Req() req,
    @Query('docType') docType?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.templates.list(orgId, req.user, { docType, branchId });
  }

  @Roles('ADMIN', 'USER')
  @Get(':id')
  get(@CurrentOrg() orgId: string, @Req() req, @Param('id') id: string) {
    return this.templates.get(orgId, id, req.user);
  }

  @Roles('ADMIN')
  @Post()
  create(@CurrentOrg() orgId: string, @Req() req, @Body() dto: CreatePrintTemplateDto) {
    return this.templates.create(orgId, req.user, dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@CurrentOrg() orgId: string, @Req() req, @Param('id') id: string, @Body() dto: UpdatePrintTemplateDto) {
    return this.templates.update(orgId, id, req.user, dto);
  }

  @Roles('ADMIN')
  @Post(':id/default')
  setDefault(@CurrentOrg() orgId: string, @Req() req, @Param('id') id: string, @Body() dto: SetDefaultDto) {
    return this.templates.setDefault(orgId, id, req.user, dto.isDefault);
  }

  @Roles('ADMIN')
  @Post(':id/duplicate')
  duplicate(@CurrentOrg() orgId: string, @Req() req, @Param('id') id: string, @Body() dto: DuplicateDto) {
    return this.templates.duplicate(orgId, id, req.user, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@CurrentOrg() orgId: string, @Req() req, @Param('id') id: string) {
    return this.templates.remove(orgId, id, req.user);
  }
}
