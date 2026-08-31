import { IsInt, IsOptional, IsString, Min, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVehicleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  plateNumber!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  vehicleModel!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vin?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometer?: number;
}