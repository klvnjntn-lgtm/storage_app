import { IsDateString, IsOptional, IsString } from 'class-validator';

export class RescheduleDeliveryOrderDto {
  // Put the delivery straight onto this route (typically one on a later
  // date). Omit to just return it to the unassigned pool.
  @IsOptional()
  @IsString()
  routeId?: string;

  // New requested delivery window for the next attempt.
  @IsOptional()
  @IsDateString()
  deliveryWindowStart?: string;

  @IsOptional()
  @IsDateString()
  deliveryWindowEnd?: string;
}
