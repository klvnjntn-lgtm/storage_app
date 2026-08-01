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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import { ProductService } from './product.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from 'src/auth/guards/org.guard';
import { CurrentOrg } from 'src/auth/decorators/org.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { ImportProductDto } from './dto/import-product.dto';

@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  create(@CurrentOrg() orgId: string, @Body() body: CreateProductDto) {
    return this.productService.create(orgId, body);
  }

  @Get()
  findAll(@CurrentOrg() orgId: string) {
    return this.productService.findAll(orgId);
  }

  @Post('import')
  import(@CurrentOrg() orgId: string, @Body() body: ImportProductDto) {
    return this.productService.bulkImport(orgId, body.rows);
  }

  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @CurrentOrg() orgId: string,
    @UploadedFile() file: any,
  ) {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet) as any[];
    return this.productService.bulkImport(orgId, rows);
  }

  @Get('search')
  search(@CurrentOrg() orgId: string, @Query('q') q: string) {
    return this.productService.search(orgId, q);
  }

  // Must come before ':id' — otherwise "by-barcode" gets swallowed as an id param.
  @Get('by-barcode/:barcode')
  findByBarcode(@CurrentOrg() orgId: string, @Param('barcode') barcode: string) {
    return this.productService.findByBarcode(orgId, barcode);
  }

  @Get(':id')
  findOne(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.productService.findOne(orgId, id);
  }

  @Delete(':id')
  archive(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.productService.archive(orgId, id);
  }

  @Patch(':id/restore')
  restore(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.productService.restore(orgId, id);
  }

  @Get(':id/events')
  getEvents(@CurrentOrg() orgId: string, @Param('id') id: string) {
    return this.productService.getEvents(orgId, id);
  }
}