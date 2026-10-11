// src/platform/dto/update-organization.dto.ts
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// Every field optional; only the ones sent are changed. paidUntil and
// billingNote accept null to clear them.
export class UpdateOrganizationDto {
  @IsOptional()
  @Matches(/^[a-z0-9_-]{1,32}$/, {
    message: 'plan must be 1–32 lowercase letters, digits, - or _',
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
      o.billingNote !== null && o.billingNote !== undefined,
  )
  @IsString()
  @MaxLength(2000)
  billingNote?: string | null;
}
