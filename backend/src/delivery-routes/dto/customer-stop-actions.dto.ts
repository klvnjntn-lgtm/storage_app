// src/delivery-routes/dto/customer-stop-actions.dto.ts
import { DeliveryPriority } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Proof for a customer stop — receiver name is required (as is the photo,
// uploaded beforehand). GPS is best-effort: the phone may refuse it.
export class RecordCustomerStopProofDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  receivedBy: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

export class RecordCustomerStopFailureDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

// Priority / requested window of a customer stop (a DO stop edits these
// on its delivery order).
export class UpdateCustomerStopDetailsDto {
  @IsOptional()
  @IsEnum(DeliveryPriority)
  priority?: DeliveryPriority;

  @IsOptional()
  @IsDateString()
  deliveryWindowStart?: string;

  @IsOptional()
  @IsDateString()
  deliveryWindowEnd?: string;
}

// A failed customer visit tried again on a route (usually a later day's;
// the same route is fine too). Unlike a DO there's no unrouted pool to
// return to, so the target route is required.
export class RescheduleCustomerStopDto {
  @IsString()
  routeId: string;

  @IsOptional()
  @IsDateString()
  deliveryWindowStart?: string;

  @IsOptional()
  @IsDateString()
  deliveryWindowEnd?: string;
}
