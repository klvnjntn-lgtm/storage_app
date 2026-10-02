import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreatePriceLevelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;
}

export class UpdatePriceLevelDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  // false = restore an archived level.
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
