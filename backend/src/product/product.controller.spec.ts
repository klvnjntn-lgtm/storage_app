import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ProductService } from './product.service';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  // GET /products
  @Get()
  findAll() {
    return this.productService.findAll();
  }

  // POST /products
  @Post()
  create(@Body() body: { name: string; categoryId: string; brandId?: string }) {
    return this.productService.create(body);
  }

  // PATCH /products/:id/category
  @Patch(':id/category')
  updateCategory(
    @Param('id') id: string,
    @Body('categoryId') categoryId: string,
  ) {
    return this.productService.updateCategory(id, categoryId);
  }

  // PATCH /products/:id/archive
  @Patch(':id/archive')
  archive(@Param('id') id: string) {
    return this.productService.archive(id);
  }

  // DELETE /products/:id (disabled logically in service, but route kept optional)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productService.remove(id);
  }

  // POST /products/import
  @Post('import')
  bulkImport(
    @Body() body: { rows: { name: string; category: string; brand?: string }[] },
  ) {
    return this.productService.bulkImport(body.rows);
  }
}