import { IsString, IsNumber, IsOptional } from 'class-validator';

export class ReceiveDto {
  @IsString()
  productId!: string;

  @IsNumber()
  qty!: number;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}