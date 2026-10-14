// src/platform/dto/platform.dto.ts
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsNumber,
  NotEquals,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UnlockRequestDto {
  @IsString()
  @MaxLength(200)
  password!: string;
}

export class UnlockConfirmDto {
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class SuspendOrganizationDto {
  // Shown to the organization's members on the suspended screen.
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class SetModuleDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class AuditLogQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  // Cursor: entries strictly older than this timestamp.
  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

// Goodwill credit or a correction to an org's WhatsApp balance, in IDR.
// Negative takes balance away (never below zero).
export class AdjustWaBalanceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @NotEquals(0)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note!: string;
}
