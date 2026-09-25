// src/delivery-order/dto/delivery-order-failure.dto.ts
import { IsDateString, IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class RecordDeliveryOrderFailureDto {
  @IsOptional()
  @IsString()
  reason?: string;

  // Single-shot GPS capture at the moment the driver reports the failed
  // attempt — same convention as RecordDeliveryOrderProofDto, not
  // continuous tracking.
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsDateString()
  failedAt?: string;
}
