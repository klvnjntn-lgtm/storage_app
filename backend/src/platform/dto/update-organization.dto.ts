// src/platform/dto/update-organization.dto.ts
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PLANS } from '../../billing/plans';

// Every field optional; only the ones sent are changed. paidUntil,
// trialEndsAt and billingNote accept null to clear them.
export class UpdateOrganizationDto {
  @IsOptional()
  @IsIn(Object.keys(PLANS), {
    message: `plan must be one of: ${Object.keys(PLANS).join(', ')}`,
  })
  plan?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  seatLimit?: number;

  @ValidateIf(
    (o: UpdateOrganizationDto) =>
      o.paidUntil !== null && o.paidUntil !== undefined,
  )
  @IsISO8601()
  paidUntil?: string | null;

  @ValidateIf(
    (o: UpdateOrganizationDto) =>
      o.trialEndsAt !== null && o.trialEndsAt !== undefined,
  )
  @IsISO8601()
  trialEndsAt?: string | null;

  @ValidateIf(
    (o: UpdateOrganizationDto) =>
      o.billingNote !== null && o.billingNote !== undefined,
  )
  @IsString()
  @MaxLength(2000)
  billingNote?: string | null;
}
