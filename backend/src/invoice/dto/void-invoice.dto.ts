import { IsNotEmpty, IsString } from 'class-validator';

export class VoidInvoiceDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}