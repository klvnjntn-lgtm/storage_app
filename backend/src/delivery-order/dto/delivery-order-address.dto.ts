import { IsOptional, IsString } from 'class-validator';

export class ApplyDeliveryOrderAddressDto {
  // A CustomerAddress of this DO's customer. Omit to reset the DO to the
  // customer's default address and pin.
  @IsOptional()
  @IsString()
  customerAddressId?: string;
}
