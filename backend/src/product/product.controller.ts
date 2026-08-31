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
import { CreateProductDto } from './dto/create-product.dto';
import { ImportProductDto } from './dto/import-product.dto';

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

  @Post()
  create(@CurrentOrg() organizationId: string, @Body() body: CreateProductDto) {
    return this.productService.create(organizationId, body);
  }

  @Get()
  findAll(@CurrentOrg() organizationId: string) {
    return this.productService.findAll(organizationId);
  }

  @Post('import')
  import(@CurrentOrg() organizationId: string, @Body() body: ImportProductDto) {
    return this.productService.bulkImport(organizationId, body.rows);
  }

  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
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

  @Delete(':id')
  archive(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.productService.archive(organizationId, id);
  }

  @Patch(':id/restore')
  restore(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.productService.restore(organizationId, id);
  }

  @Get(':id/events')
  getEvents(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.productService.getEvents(organizationId, id);
  }
}