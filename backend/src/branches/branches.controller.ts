import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { BranchesService } from './branches.service';

class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;
}

class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;
}

// Not module-gated: any business can have branches (unlike stock
// locations). Every member can list them, for the pickers; MASTER manages.
@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  list(@CurrentOrg() orgId: string, @Query('includeArchived') includeArchived?: string) {
    return this.branches.list(orgId, includeArchived === 'true');
  }

  @UseGuards(RolesGuard)
  @Roles('MASTER')
  @Post()
  create(@CurrentOrg() orgId: string, @Body() dto: CreateBranchDto) {
    return this.branches.create(orgId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('MASTER')
  @Patch(':id')
  update(@CurrentOrg() orgId: string, @Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(orgId, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('MASTER')
  @Post(':id/archive')
  archive(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.branches.archive(orgId, id);
  }

  @UseGuards(RolesGuard)
  @Roles('MASTER')
  @Post(':id/restore')
  restore(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.branches.restore(orgId, id);
  }
}
