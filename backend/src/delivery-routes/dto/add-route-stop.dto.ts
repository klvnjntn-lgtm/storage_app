// src/delivery-routes/dto/add-route-stop.dto.ts
import { DeliveryPriority } from '@prisma/client';
import {
  IsBoolean,
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

  // Customer stops only: one of the customer's saved addresses to go to
  // instead of their main address.
  @IsOptional()
  @IsString()
  customerAddressId?: string;

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

  // The office was told this customer and address are already pending on the
  // route, and said to add it anyway.
  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;

  // Omit to append at the end of the route.
  @IsOptional()
  @IsInt()
  @IsPositive()
  sequence?: number;
}
