import { DiscountType, InvoiceFormat, InvoiceStatus, PaymentStatus } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsDateString,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
export class InvoiceLineInput {
  // Product lines require this; service lines (WORKSHOP_RMS only) omit it
  // in favor of `description` below — the two are mutually exclusive.
  // Real enforcement of "must have exactly one of productId/description,
  // and org must have WORKSHOP_RMS for a service line" happens in
  // InvoiceService.priceLines(), since that needs a DB lookup this DTO
  // can't do. ValidateIf here just keeps obviously-malformed requests
  // (e.g. neither field present) from reaching the service at all.
  @ValidateIf((o) => !o.description)
  @IsUUID()
  productId?: string;

  // NEW — WORKSHOP_RMS service line. Free-text description of work
  // performed, standing in for productId. See InvoiceService.priceLines().
  @ValidateIf((o) => !o.productId)
  @IsString()
  @IsNotEmpty()
  description?: string;

  // NEW — which location this line was actually pulled from. A cart can
  // mix items sourced from different locations, so this can't be assumed
  // to equal the invoice's own locationId. See InvoiceService.priceLines()
  // and issue().
  //
  // Required for product lines (stock has to come from somewhere),
  // omitted entirely for service lines (nothing to deduct).
  //
  // NOTE: Location.id is NOT a UUID — LocationService.create() assigns a
  // deterministic slug id (`${orgId}_${slugified name}`), not Prisma's
  // default @default(uuid()). So this must stay a plain non-empty string,
  // not @IsUUID().
  @ValidateIf((o) => !!o.productId)
  @IsString()
  @IsNotEmpty()
  locationId?: string;

  @IsInt()
  @IsPositive()
  quantity: number;

  // Product lines: staff-entered price override, only honored server-side
  // when the organization has posPricingEnabled: true (see priceLines()).
  // Service lines: this IS the price, and it's required — but that
  // requirement can't be expressed here since "required" depends on
  // whether this is a service line, which depends on which of
  // productId/description was sent. Enforced in priceLines() instead,
  // where a missing unitPrice on a service line throws explicitly
  // ("Service price is required (use 0 if free)") rather than silently
  // defaulting to anything.
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  // Tax rate(s) applied to this line — snapshotted into InvoiceItemTax
  // on save. See InvoiceService.priceLines(). Applies equally to product
  // and service lines.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(4, { each: true })
  taxRateIds?: string[];

  @IsOptional()
  @IsString()
  unit?: string;

  // NEW — per-item discount. Replaces the old document-level
  // discountType/discountValue on CreateDraftInvoiceDto/UpdateDraftInvoiceDto.
  // PERCENTAGE's 0–100 bound is enforced in
  // LineItemPricingService.computeLineDiscount(), not here, since it
  // needs a clear per-line error message pointing at which line failed.
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;
}

export class CreateDraftInvoiceDto {
    @IsOptional()
  @IsString()
  @IsNotEmpty()
  locationId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  odometer?: number;

  @IsEnum(InvoiceFormat)
  format: InvoiceFormat;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  // REMOVED: top-level discountType/discountValue. Discount is now
  // per-item only (InvoiceLineInput.discountType/discountValue) —
  // keeping both a document-level and per-item discount input risked
  // exactly the double-discount bug this refactor exists to prevent.
  // Invoice.discountType/discountValue remain in the schema as
  // deprecated/read-only columns for historical invoices only.

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineInput)
  items: InvoiceLineInput[];

  @IsOptional()
  @IsString()
  customerPoNumber?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateDraftInvoiceDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineInput)
  items?: InvoiceLineInput[];

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  odometer?: number;

  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  // REMOVED: top-level discountType/discountValue — see CreateDraftInvoiceDto.

  @IsOptional()
  @IsString()
  customerPoNumber?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RevenueReportQueryDto {
  @IsISO8601()
  from: string; // ISO date — converted to Date in the controller before hitting the service

  @IsISO8601()
  to: string; // ISO date — converted to Date in the controller before hitting the service

  // NOTE: Location.id is a slug (see InvoiceLineInput), not a UUID.
  @IsOptional()
  @IsString()
  locationId?: string;
}

export class ListInvoicesQueryDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  // ISO date. What this actually filters on depends on dateField below:
  // 'issued' (default) — issuedAt for ISSUED invoices, createdAt for
  // everything else (so DRAFTs, which have no issuedAt, still show up).
  // 'invoice' — invoiceDate for every status.
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  // Which date field `from`/`to` filter against. Defaults to 'issued' in
  // the service if omitted, so existing callers that don't send this are
  // unaffected.
  @IsOptional()
  @IsIn(['issued', 'invoice'])
  dateField?: 'issued' | 'invoice';

  // NOTE: Location.id is a slug (see InvoiceLineInput), not a UUID.
  @IsOptional()
  @IsString()
  locationId?: string;
    @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
@IsOptional()
@IsString()
search?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overdue?: boolean;
}