import {
  IsString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsIn,
} from 'class-validator';

const RETURN_REASONS = [
  'DAMAGED',
  'WRONG_ITEM',
  'CHANGED_MIND',
  'DEFECTIVE',
  'OTHER',
] as const;

export class AddSessionItemDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @IsPositive()
  qty!: number;

  @IsOptional()
  @IsString()
  fromLocationId?: string;

  @IsOptional()
  @IsString()
  toLocationId?: string;

  @IsOptional()
  @IsIn(RETURN_REASONS)
  reason?: string;
}