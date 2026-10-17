import { IsString, IsNumber, IsPositive, IsOptional, IsArray } from 'class-validator';

export class WarehouseMoveDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  qty!: number;

  @IsString()
  fromLocationId!: string;

  @IsString()
  toLocationId!: string;

  // Serial-tracked products: the units moving, one per quantity.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}
