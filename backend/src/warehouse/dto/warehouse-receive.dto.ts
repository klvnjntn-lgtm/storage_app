import { IsString, IsNumber, IsOptional, IsPositive } from 'class-validator';

export class WarehouseReceiveDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  qty!: number;

  @IsOptional()
  @IsString()
  locationId?: string;
}
