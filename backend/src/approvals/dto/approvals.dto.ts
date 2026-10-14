import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApprovalDocumentType } from '@prisma/client';

export class RequestApprovalDto {
  @IsEnum(ApprovalDocumentType)
  documentType!: ApprovalDocumentType;

  @IsString()
  documentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DecideApprovalDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// null switches a rule off.
export class ApprovalSettingsDto {
  @IsOptional()
  @ValidateIf((o: ApprovalSettingsDto) => o.poApprovalThreshold !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  poApprovalThreshold?: number | null;

  @IsOptional()
  @ValidateIf((o: ApprovalSettingsDto) => o.discountApprovalPercent !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountApprovalPercent?: number | null;
}
