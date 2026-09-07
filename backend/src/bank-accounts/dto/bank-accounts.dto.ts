import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  bankName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  accountNumber: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  accountName: string;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  accountName?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}