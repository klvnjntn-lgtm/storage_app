// src/product/dto/update-product.dto.ts
import { Type } from 'class-transformer';
import { ProductLevelPriceDto } from './product-level-price.dto';
import { IsArray, ValidateNested, IsString, IsOptional, MinLength, IsNumber, Min } from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sku?: string;

  @IsOptional()
  @IsString()
  oem?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  category?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sellingPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  // URL of a MediaAsset picked from the media library, or null to clear
  // the product's photo. See ProductService.update.
  @IsOptional()
  @IsString()
  image?: string | null;

  // Prices for the non-default price levels (the default level's price is
  // sellingPrice). Only the levels listed are touched.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductLevelPriceDto)
  prices?: ProductLevelPriceDto[];
}
