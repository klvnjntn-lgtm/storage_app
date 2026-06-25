import {
  IsArray,
  IsString,
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
}

export class ImportProductDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductRow)
  rows!: ProductRow[];
}