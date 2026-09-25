// src/delivery-order/dto/delivery-order-details.dto.ts
import { DeliveryPriority } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export class UpdateDeliveryOrderDetailsDto {
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
