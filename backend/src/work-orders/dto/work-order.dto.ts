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

export class CreateWorkOrderDto {
  // The customer is taken from the vehicle.
  @IsString()
  @IsNotEmpty()
  vehicleId: string;

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkOrderLineInput)
  items?: WorkOrderLineInput[];

  // Save as an estimate awaiting the customer's approval instead of
  // checking the car straight in.
  @IsOptional()
  @IsBoolean()
  asEstimate?: boolean;

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

export class ApproveWorkOrderDto {
  // How the go-ahead was given, e.g. "Signed SPK", "By phone — Budi".
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CreateRecommendationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  note: string;

  @IsISO8601()
  dueDate: string;
}

// The customer's answer on the approval page.
export class RespondToEstimateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  // The estimate's version as shown to them (see publicEstimate).
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  version: string;
}

export class CreateWorkOrderInvoiceDto {
  @IsOptional()
  @IsEnum(InvoiceFormat)
  format?: InvoiceFormat;
}
