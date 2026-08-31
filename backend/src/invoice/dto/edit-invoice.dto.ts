import { Type } from 'class-transformer';
import { DiscountType } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsNotEmpty,
  Min,
  ValidateNested,
} from 'class-validator';

export class EditInvoiceItemDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  locationId?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  taxRateIds?: string[];

  // NEW — per-item discount, same shape as InvoiceLineInput. Without
  // this, editIssuedInvoice's dto.items had no way to carry a discount
  // through to LineItemPricingService.priceLines(), so any edit made via
  // this DTO would silently strip discount from every line (since
  // priceLines treats a missing discountType/discountValue as "no
  // discount"), even if the original invoice items had one.
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  // Meaning depends on discountType — currency amount for FIXED, 0–100
  // for PERCENTAGE. The 0–100 bound isn't enforced here; it's enforced
  // per-line in LineItemPricingService.computeLineDiscount(), same as
  // InvoiceLineInput.
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;
}

export class EditIssuedInvoiceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EditInvoiceItemDto)
  items: EditInvoiceItemDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  odometer?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}