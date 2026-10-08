import { IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';

export class ApplyCreditDto {
  // Take the credit from this invoice. Omitted: from any of the customer's
  // invoices holding credit, oldest first.
  @IsOptional()
  @IsUUID()
  sourceInvoiceId?: string;

  // Omitted: as much as the credit and this invoice's balance allow.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;
}
