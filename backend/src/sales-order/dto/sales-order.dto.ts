import { SalesOrderFormat, DiscountType } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderLineItemDto {
  // Mirrors InvoiceLineInput/QuotationLineItemDto exactly — product lines
  // require productId, service-style lines use description instead.
  @ValidateIf((o) => !o.description)
  @IsUUID()
  productId?: string;

  @ValidateIf((o) => !o.productId)
  @IsString()
  @IsNotEmpty()
  description?: string;

  // Same NOTE as InvoiceLineInput: Location.id is a slug, not a UUID.
  @ValidateIf((o) => !!o.productId)
  @IsString()
  @IsNotEmpty()
  locationId?: string;

  @IsInt()
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

  // Per-item discount — 0–100 bound for PERCENTAGE enforced in
  // LineItemPricingService.computeLineDiscount(), not here.
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;
}

export class CreateSalesOrderDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  // NEW — matches SalesOrder.customerPoNumber
  @IsOptional()
  @IsString()
  customerPoNumber?: string;

  // NEW — matches SalesOrder.orderDate (@db.Date). ISO date string,
  // parsed with `new Date(dto.orderDate)` in the service, same
  // convention as Invoice.invoiceDate.
  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsEnum(SalesOrderFormat)
  format?: SalesOrderFormat;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineItemDto)
  items: OrderLineItemDto[];
}

export class UpdateSalesOrderDto {
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  // NEW
  @IsOptional()
  @IsString()
  customerPoNumber?: string;

  // NEW
  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @IsOptional()
  @IsEnum(SalesOrderFormat)
  format?: SalesOrderFormat;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderLineItemDto)
  items?: OrderLineItemDto[];
}