import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateConnectionDto {
  @IsString()
  provider!: string; // "accurate_desktop_csv", "other_saas_csv", etc.

  @IsOptional()
  @IsObject()
  columnMapping?: Record<string, string>;
}