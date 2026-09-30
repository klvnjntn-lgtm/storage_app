import { IsIn, IsOptional, IsString } from 'class-validator';
import { SessionType } from '@prisma/client';

// ADJUSTMENT is deliberately excluded: it has no matching EventType, so
// SessionsService.addItem() rejects every scan into one — creating it from
// the API would just leave an unusable session behind. Stock adjustments
// go through StockService.adjust() instead.
export const CREATABLE_SESSION_TYPES = [
  SessionType.RECEIVE,
  SessionType.RETURNS,
  SessionType.MOVE,
  SessionType.FULFILLMENT,
] as const;

export class CreateSessionDto {
  @IsIn(CREATABLE_SESSION_TYPES)
  type!: (typeof CREATABLE_SESSION_TYPES)[number];

  // RECEIVE only — the stock import being count-checked (required).
  @IsOptional()
  @IsString()
  importBatchId?: string;

  // RETURNS only — the invoice being returned (required when the org
  // invoices).
  @IsOptional()
  @IsString()
  returnInvoiceId?: string;
}
