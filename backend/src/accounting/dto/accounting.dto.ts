import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { AccountType, NormalBalance } from '@prisma/client';

export class CreateAccountDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsEnum(AccountType)
  type: AccountType;

  @IsEnum(NormalBalance)
  normalBalance: NormalBalance;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  // false is rejected server-side for systemKey accounts — see
  // ChartOfAccountsService.update().
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class ManualJournalLineDto {
  @IsUUID()
  accountId: string;

  // FIX — was @IsNumber() with no maxDecimalPlaces. Storage is
  // Decimal(14,2), so excess-precision input gets silently rounded by
  // Postgres at insert; combined with the journal balance check running
  // in JS beforehand, a debit/credit with enough hidden precision could
  // pass the balance check yet become genuinely unbalanced once each
  // column is independently rounded on write.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  description?: string;

  // FIX — was missing entirely, so a client-supplied locationId on a
  // manual entry line was silently stripped by the global whitelist
  // ValidationPipe before ever reaching the controller (which cast
  // dto.lines as if it could carry one). Every other posting rule in
  // posting-rules.service.ts tags lines with locationId for per-location
  // P&L — manual entries were the one path that structurally couldn't.
  @IsOptional()
  @IsString()
  locationId?: string;
}

export class CreateManualJournalEntryDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  memo?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => ManualJournalLineDto)
  lines: ManualJournalLineDto[];
}