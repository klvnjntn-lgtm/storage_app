import { Type } from 'class-transformer';
import {
  IsArray, IsDateString, IsNumber, IsOptional, IsPositive, IsString,
  IsUUID, MaxLength, Min, ValidateNested, IsNotEmpty, ArrayMinSize,
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

  // NEW — when the goods are expected to ARRIVE. The schema field already
  // existed; the service just never wrote it from the DTO before.
  @IsOptional() @IsDateString()
  expectedDate?: string;

  // NEW — when payment is due to the supplier. Deliberately separate from
  // expectedDate: delivery timing and payment timing are different things,
  // and AP aging buckets against THIS one.
  @IsOptional() @IsDateString()
  dueDate?: string;

  // NEW — free text, same as Invoice.paymentTerms ("Net 30", "COD", ...).
  // Human-readable only; dueDate is what the system actually ages against,
  // so whatever UI collects these should keep the two consistent.
  @IsOptional() @IsString() @MaxLength(200)
  paymentTerms?: string;

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

  @IsOptional() @IsDateString()
  expectedDate?: string;

  @IsOptional() @IsDateString()
  dueDate?: string;

  @IsOptional() @IsString() @MaxLength(200)
  paymentTerms?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PurchaseOrderItemDto)
  items?: PurchaseOrderItemDto[];
}