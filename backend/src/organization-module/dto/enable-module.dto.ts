import { IsEnum, IsOptional, IsISO8601 } from 'class-validator';
import { ModuleKey } from '@prisma/client';

export class EnableModuleDto {
  @IsEnum(ModuleKey)
  module: ModuleKey;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string; // ISO date — omit for a module that never expires
}