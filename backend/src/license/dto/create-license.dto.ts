import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateLicenseDto {
  @IsString()
  key!: string;

  @IsString()
  customerName!: string;

  @IsString()
  branchName!: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}