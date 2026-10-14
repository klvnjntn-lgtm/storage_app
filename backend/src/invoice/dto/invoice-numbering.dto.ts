import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { MAX_FORMAT_LENGTH } from '../../shared/documents/document-number-format.util';

export class UpdateInvoiceNumberingDto {
  // Token rules are checked by validateNumberFormat in the service.
  @IsString()
  @MaxLength(MAX_FORMAT_LENGTH)
  format: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  nextNumber?: number;
}
