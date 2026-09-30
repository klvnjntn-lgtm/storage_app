// src/delivery-routes/dto/add-route-stop.dto.ts
import { DeliveryPriority } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

// Exactly one of deliveryOrderId / customerId (checked in the service,
// which also enforces "DO required with INVOICE_POS").
export class AddRouteStopDto {
  @IsOptional()
  @IsString()
  deliveryOrderId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  // Customer stops only — a DO stop takes these from its DO.
  @IsOptional()
  @IsEnum(DeliveryPriority)
  priority?: DeliveryPriority;

  @IsOptional()
  @IsDateString()
  deliveryWindowStart?: string;

  @IsOptional()
  @IsDateString()
  deliveryWindowEnd?: string;

  // Omit to append at the end of the route.
  @IsOptional()
  @IsInt()
  @IsPositive()
  sequence?: number;
}
