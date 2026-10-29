import { InvoiceFormat, WorkOrderStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// A part (productId + locationId) or a labour line (description +
// unitPrice) — the same split InvoiceLineInput makes, since every line
// here becomes an invoice line later.
export class WorkOrderLineInput {
  @ValidateIf((o) => !o.description)
  @IsUUID()
  productId?: string;

  @ValidateIf((o) => !o.productId)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description?: string;

  // Location ids are slugs, not UUIDs (see InvoiceLineInput.locationId).
  @ValidateIf((o) => !!o.productId)
  @IsString()
  @IsNotEmpty()
  locationId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;

  // Required on labour lines; on parts only honoured with POS pricing on.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number;
}

// One line added from elsewhere (the parts catalogue). A part may leave the
// location out: the one holding most of it is used.
export class AddWorkOrderLineDto {
  @ValidateIf((o) => !o.description)
  @IsUUID()
  productId?: string;

  @ValidateIf((o) => !o.productId)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number;
}

export class CreateWorkOrderDto {
  // The customer is taken from the vehicle.
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

  // The car came back for the same problem: the earlier job (same vehicle) this one redoes.
  @IsOptional()
  @IsUUID()
  comebackOfId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  comebackReason?: string;

  @IsOptional()
  @IsUUID()
  mechanicId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometer?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  complaint?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  // The branch doing the job (multi-branch workshops); left out on create:
  // the parts' location's branch, else the first.
  @IsOptional()
  @IsString()
  branchId?: string;

  // Formal-estimate details (fleet customers).
  @IsOptional()
  @IsISO8601()
  validUntil?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerPoNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentTerms?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkOrderLineInput)
  items?: WorkOrderLineInput[];


  // Started from this vehicle's pending reminder (recommended work):
  // the reminder is completed and linked to the new job.
  @IsOptional()
  @IsString()
  fromReminderId?: string;
}

export class UpdateWorkOrderDto {
  @IsOptional()
  @IsUUID()
  mechanicId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometer?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  complaint?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  // The branch doing the job (multi-branch workshops); left out on create:
  // the parts' location's branch, else the first.
  @IsOptional()
  @IsString()
  branchId?: string;

  // Formal-estimate details (fleet customers).
  @IsOptional()
  @IsISO8601()
  validUntil?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerPoNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentTerms?: string | null;

  // Replaces every line when present.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkOrderLineInput)
  items?: WorkOrderLineInput[];
}

export class SetWorkOrderStatusDto {
  @IsEnum(WorkOrderStatus)
  status: WorkOrderStatus;
}

export class CreateRecommendationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  note: string;

  @IsISO8601()
  dueDate: string;

  // Also due at this odometer reading (km), whichever comes first.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dueOdometer?: number;
}

// Converting a quotation: optionally who'll do the job.
export class CreateWorkOrderFromQuotationDto {
  @IsOptional()
  @IsString()
  mechanicId?: string;
}

export class CreateWorkOrderInvoiceDto {
  @IsOptional()
  @IsEnum(InvoiceFormat)
  format?: InvoiceFormat;
}
