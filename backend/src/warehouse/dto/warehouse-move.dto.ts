import { IsString, IsNumber, IsPositive } from 'class-validator';

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
}
