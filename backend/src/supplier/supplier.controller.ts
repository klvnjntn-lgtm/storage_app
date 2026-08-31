import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { SupplierService } from './supplier.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('suppliers')
export class SupplierController {
  constructor(private supplierService: SupplierService) {}

  @Post()
  create(@CurrentOrg() organizationId: string, @Body() dto: CreateSupplierDto) {
    return this.supplierService.create(organizationId, dto);
  }

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.supplierService.list(organizationId, {
      search,
      isActive: isActive === undefined ? undefined : isActive === 'true',
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  getOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.supplierService.getOne(organizationId, id);
  }

  @Patch(':id')
  update(@CurrentOrg() organizationId: string, @Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.supplierService.update(organizationId, id, dto);
  }

  @Patch(':id/deactivate')
  deactivate(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.supplierService.deactivate(organizationId, id);
  }

  @Delete(':id')
  delete(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.supplierService.delete(organizationId, id);
  }
}