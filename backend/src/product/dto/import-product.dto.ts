import {
  IsArray,
  IsString,
  IsNumber,
  Min,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

class ProductRow {
  @IsString()
  name!: string;

  @IsString()
  sku!: string;

  @IsOptional()
  @IsString()
  oem?: string;

  @IsString()
  category!: string;

  @IsOptional()
  @IsString()
  brand?: string;

  // FIX — same gap as CreateProductDto: ProductService.resolveForImport()
  // fully supports these, but the global whitelist ValidationPipe
  // silently stripped them since they weren't declared here. Only the
  // unvalidated /products/import-excel path (raw XLSX rows, no DTO)
  // could actually set prices on import until now.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sellingPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  costPrice?: number;
}

export class ImportProductDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductRow)
  rows!: ProductRow[];
}