// src/product/product.controller.ts — full file, only the import list and searchForInvoice changed
import {
  Controller,
  Get,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Post,
  Patch,
  Body,
  Param,
  Delete,
  Query,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import { ModuleKey } from '@prisma/client';
import { ProductService } from './product.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { ImportProductDto } from './dto/import-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
// Writes (create, import, edit, archive, restore) are admin-only, via
// RolesGuard per method; reads stay open to every signed-in user.
// Class-level guards deliberately stop at JwtAuthGuard/OrgGuard — most
// of this controller (listing, search, barcode lookup) is core
// infrastructure available regardless of module status, same reasoning
// as LocationController. search-for-invoice is the one exception,
// gated at the method level below since it's specifically the
// POS-invoice product picker.
@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post()
  create(@CurrentOrg() organizationId: string, @Body() body: CreateProductDto, @Req() req) {
    return this.productService.create(organizationId, body, undefined, req.user?.sub);
  }

  // Cost price is admin-only data; everyone else gets the list without it.
  @Get()
  findAll(@CurrentOrg() organizationId: string, @Req() req) {
    return this.productService.findAll(organizationId, req.user?.role === 'ADMIN');
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('import')
  import(@CurrentOrg() organizationId: string, @Body() body: ImportProductDto) {
    return this.productService.bulkImport(organizationId, body.rows);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('import-excel')
  // Same 10MB cap as the CSV order import (integration.controller.ts): the
  // whole workbook is buffered in memory and parsed synchronously.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async importExcel(@CurrentOrg() organizationId: string, @UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet) as any[];
    return this.productService.bulkImport(organizationId, rows);
  }

  @Get('search')
  search(@CurrentOrg() organizationId: string, @Query('q') q?: string, @Query('query') query?: string) {
    return this.productService.search(organizationId, q ?? query ?? '');
  }

  // Gated: this is the POS-invoice product picker, not general search.
  // Either module works, same reasoning as CustomersController — an
  // org needs INVOICE_POS or WORKSHOP_RMS to build an invoice at all.
  @UseGuards(ModuleGuard)
  @RequireModule(ModuleKey.INVOICE_POS, ModuleKey.WORKSHOP_RMS)
  @Get('search-for-invoice')
  searchForInvoice(
    @CurrentOrg() organizationId: string,
    @Query('q') q?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.productService.searchForInvoice(organizationId, q ?? '', locationId);
  }

  @Get('by-barcode/:barcode')
  findByBarcode(@CurrentOrg() organizationId: string, @Param('barcode') barcode: string) {
    return this.productService.findByBarcode(organizationId, barcode);
  }

  @Get(':id')
  findOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.productService.findOne(organizationId, id);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  archive(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.productService.archive(organizationId, id);
  }
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':id')
update(
  @CurrentOrg() organizationId: string,
  @Param('id') id: string,
  @Body() body: UpdateProductDto,
  @Req() req,
) {
  return this.productService.update(organizationId, id, body, undefined, req.user?.sub);
}
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Patch(':id/restore')
  restore(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.productService.restore(organizationId, id);
  }

  // Cost is admin-only data, same as costPrice itself.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Get(':id/cost-history')
  getCostHistory(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.productService.getCostHistory(organizationId, id);
  }

  @Get(':id/events')
  getEvents(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.productService.getEvents(organizationId, id);
  }
}