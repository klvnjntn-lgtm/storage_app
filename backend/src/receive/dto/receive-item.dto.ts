import { IsString, IsNumber, IsOptional, IsPositive } from 'class-validator';

export class ReceiveItemDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  qty!: number;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}