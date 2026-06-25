import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { BrandService } from './brand.service';
import { RenameDto } from '../common/dto/rename.dto';
import { MergeDto } from '../common/dto/merge.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from 'src/auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from 'src/auth/decorators/org.decorator';

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('brands')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Get()
  findAll(@CurrentOrg() orgId: string) {
    return this.brandService.findAll(orgId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post()
  create(@CurrentOrg() orgId: string, @Body('name') name: string) {
    return this.brandService.create(orgId, name);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':id')
  rename(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() dto: RenameDto,
  ) {
    return this.brandService.rename(orgId, id, dto.name);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('merge')
  merge(@CurrentOrg() orgId: string, @Body() dto: MergeDto) {
    return this.brandService.merge(orgId, dto.sourceIds, dto.targetId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  delete(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.brandService.delete(orgId, id);
  }
}