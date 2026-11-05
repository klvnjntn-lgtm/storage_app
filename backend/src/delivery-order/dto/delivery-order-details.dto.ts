// src/delivery-order/dto/delivery-order-details.dto.ts
import { DeliveryPriority } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

// A window edge left out stays as it is; null clears it.
export class UpdateDeliveryOrderDetailsDto {
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
