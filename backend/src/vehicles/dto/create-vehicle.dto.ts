import { IsInt, IsOptional, IsString, Max, Min, MaxLength, MinLength } from 'class-validator';
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

  // The car as the parts catalogue names it (PartCatalogEntry.carBrand / model), so its plate opens
  // straight to its parts. Null clears.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  carBrand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  carModel?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1950)
  @Max(2100)
  carYear?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  engine?: string | null;
}