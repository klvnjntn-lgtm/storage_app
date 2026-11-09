// src/delivery-routes/dto/customer-stop-actions.dto.ts
import { DeliveryPriority } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  IsString,
  MaxLength,
} from 'class-validator';

// Proof for a customer stop — receiver name is required (as is the photo,
// uploaded beforehand). GPS is required when a driver records it (see
// driver-proof.ts), optional for office staff.
export class RecordCustomerStopProofDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  receivedBy: string;

  // When the proof photo was taken; defaults to now.
  @IsOptional()
  @IsDateString()
  signedAt?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  // GeolocationCoordinates.accuracy, in metres.
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;
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
// on its delivery order). A window edge left out stays as it is; null clears it.
export class UpdateCustomerStopDetailsDto {
  @IsOptional()
  @IsEnum(DeliveryPriority)
  priority?: DeliveryPriority;

  @IsOptional()
  @IsDateString()
  deliveryWindowStart?: string | null;

  @IsOptional()
  @IsDateString()
  deliveryWindowEnd?: string | null;
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

// Which address a pending customer stop goes to: a saved address, or the
// customer's main address when customerAddressId is omitted.
export class ApplyStopAddressDto {
  @IsOptional()
  @IsString()
  customerAddressId?: string;
}

// The stop a result recorded on the wrong one belongs to (moveStopResult).
export class MoveStopResultDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  toStopId: string;
}
