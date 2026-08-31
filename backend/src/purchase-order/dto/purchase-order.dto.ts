import { Type } from 'class-transformer';
import {
  IsArray, IsNumber, IsOptional, IsPositive, IsString,
  IsUUID, Min, ValidateNested, IsNotEmpty, ArrayMinSize,
} from 'class-validator';

export class NewProductDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsString() @IsNotEmpty()
  sku: string;

  @IsString() @IsNotEmpty()
  category: string;

  @IsOptional() @IsString()
  brand?: string;

  @IsOptional() @IsString()
  oem?: string;

  @IsOptional() @IsString()
  barcode?: string;

  @IsOptional() @IsNumber() @Min(0)
  sellingPrice?: number;

  @IsOptional() @IsNumber() @Min(0)
  costPrice?: number;
}

export class PurchaseOrderItemDto {
  // Exactly one of these two must be set — enforced in the service,
  // not here, because "exactly one of A/B" needs custom cross-field
  // logic that's clearer to read as a plain check than as a decorator.
  @IsOptional() @IsUUID()
  productId?: string;

  @IsOptional() @ValidateNested() @Type(() => NewProductDto)
  newProduct?: NewProductDto;

  @IsNumber() @IsPositive()
  quantity: number;

  @IsNumber() @Min(0)
  unitCost: number;
}

export class CreatePurchaseOrderDto {
  @IsOptional() @IsUUID()
  locationId?: string;

  @IsOptional() @IsUUID()
  supplierId?: string;

  @IsOptional() @IsNumber() @Min(0)
  discountAmount?: number;

  @IsOptional() @IsUUID()
  taxRateId?: string;

  @IsOptional() @IsString()
  notes?: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PurchaseOrderItemDto)
  items: PurchaseOrderItemDto[];
}

export class UpdatePurchaseOrderDto {
  @IsOptional() @IsUUID()
  locationId?: string;

  @IsOptional() @IsUUID()
  supplierId?: string;

  @IsOptional() @IsNumber() @Min(0)
  discountAmount?: number;

  @IsOptional() @IsUUID()
  taxRateId?: string;

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PurchaseOrderItemDto)
  items?: PurchaseOrderItemDto[];
}