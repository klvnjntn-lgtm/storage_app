import { HttpException, HttpStatus } from '@nestjs/common';

// Thrown by StockService.fulfill() under StockPolicy.WARN when a line would
// oversell and the caller hasn't set confirmOversell. The client is meant to
// show the shortfall and resubmit the same request with confirmOversell:
// true. 409 (not 400) so it's distinguishable from an ordinary validation
// error and from BLOCK's plain "Insufficient stock" BadRequestException.
export class StockConfirmationRequiredException extends HttpException {
  constructor(details: { productId: string; locationId: string; available: number; requested: number }) {
    super(
      {
        error: 'STOCK_CONFIRMATION_REQUIRED',
        message: `Only ${details.available} in stock, sell ${details.requested} anyway?`,
        ...details,
      },
      HttpStatus.CONFLICT,
    );
  }
}
