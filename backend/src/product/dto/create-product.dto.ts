// src/product/dto/create-product.dto.ts
import { Type } from 'class-transformer';
import { ProductLevelPriceDto } from './product-level-price.dto';
import { IsArray, ValidateNested, IsString, IsOptional, IsNumber, Min, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  sku!: string;

  @IsOptional()
  @IsString()
  oem?: string;

  @IsString()
  @MinLength(1)
  category!: string;

  @IsOptional()
  @IsString()
  brand?: string;

  // FIX — these were missing from the DTO while ProductService.create()
  // fully supports and validates them. Since main.ts's global
  // ValidationPipe has whitelist: true, any sellingPrice/costPrice the
  // frontend sent was silently stripped before reaching the controller —
  // every product created via the admin UI got null pricing regardless
  // of what was typed, requiring a separate PATCH to actually set it.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  sellingPrice?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  costPrice?: number;

  // Prices for the non-default price levels (the default level's price is
  // sellingPrice). Only the levels listed are touched.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductLevelPriceDto)
  prices?: ProductLevelPriceDto[];
}
