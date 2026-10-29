import { QuotationFormat, DiscountType } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  MaxLength,
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

  // Requested price level. Only a request — the server looks up the
  // product's price for it (LineItemPricingService), never trusting a
  // client-sent price unless POS pricing is on.
  @IsOptional()
  @IsString()
  priceLevelId?: string;

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
  // The branch it belongs to; left out: the location's branch, else the first. Branch staff always
  // get their own.
  @IsOptional()
  @IsString()
  branchId?: string;

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

  // Workshops only: the car quoted for, its odometer and the complaint — carried to the work order.
  @IsOptional()
  @IsString()
  vehicleId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  odometer?: number | null;

  @IsOptional()
  @IsString()
  complaint?: string | null;

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

  // Workshops only: the car quoted for, its odometer and the complaint — carried to the work order.
  @IsOptional()
  @IsString()
  vehicleId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  odometer?: number | null;

  @IsOptional()
  @IsString()
  complaint?: string | null;

  @IsOptional()
  @IsEnum(QuotationFormat)
  format?: QuotationFormat;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationLineItemDto)
  items?: QuotationLineItemDto[];
}
// The customer's answer through the approval link: who they are, and (when declining) why. `version`
// is the one they were shown — refused if the workshop changed the quotation since.
export class RespondToQuotationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsString()
  @IsNotEmpty()
  version: string;
}

// One quotation line and how much of it to order / invoice now.
export class ConvertQuotationLineDto {
  @IsString()
  @IsNotEmpty()
  quotationItemId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;
}

// Converting a quotation to a sales order or invoice: the lines and quantities to take now. Left out:
// everything still left on the quotation.
export class ConvertQuotationDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConvertQuotationLineDto)
  lines?: ConvertQuotationLineDto[];
}
