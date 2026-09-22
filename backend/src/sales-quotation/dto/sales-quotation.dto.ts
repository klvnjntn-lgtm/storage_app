import { QuotationFormat, DiscountType } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QuotationLineItemDto {
  @ValidateIf((o) => !o.description)
  @IsUUID()
  productId?: string;

  @ValidateIf((o) => !o.productId)
  @IsString()
  @IsNotEmpty()
  description?: string;

  @ValidateIf((o) => !!o.productId)
  @IsString()
  @IsNotEmpty()
  locationId?: string;

  // FIX — was @IsInt(); SalesQuotationItem.quantity is Decimal(12,2), same
  // as SalesOrderItem.quantity (see sales-order.dto.ts's identical fix).
  // Fractional quantities (e.g. 2.5 kg) are supported at the DB level and
  // on the sales-order DTO — a product sold in fractional units couldn't
  // be quoted first without this, breaking the quotation→order path.
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(4, { each: true })
  taxRateIds?: string[];

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;
}

export class CreateSalesQuotationDto {
  // FIX — was @IsString() @IsNotEmpty() with no @IsOptional(), which
  // rejected any request that omitted locationId even though the field
  // is typed `?` and the frontend explicitly supports service-only
  // quotations with no product lines (and therefore no location to
  // infer). This made every pure-service quotation submitted through
  // the actual UI fail validation with a 400.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  locationId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;
@IsOptional()
@IsString()
bankAccountId?: string | null;
  @IsOptional()
  @IsString()
  customerPoNumber?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsDateString()
  quotationDate?: string;

  @IsOptional()
  @IsString()
  termsAndConditions?: string;

  @IsEnum(QuotationFormat)
  format: QuotationFormat;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationLineItemDto)
  items: QuotationLineItemDto[];
}

export class UpdateSalesQuotationDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;
@IsOptional()
@IsString()
bankAccountId?: string | null;
  @IsOptional()
  @IsString()
  customerName?: string;
  @IsOptional()
  @IsBoolean()
  clearItems?: boolean;
  @IsOptional()
  @IsString()
  customerPoNumber?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsDateString()
  quotationDate?: string;

  @IsOptional()
  @IsString()
  termsAndConditions?: string;

  @IsOptional()
  @IsEnum(QuotationFormat)
  format?: QuotationFormat;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationLineItemDto)
  items?: QuotationLineItemDto[];
}