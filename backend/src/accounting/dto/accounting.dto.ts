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

  @IsOptional()
  @IsNumber()
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  description?: string;
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