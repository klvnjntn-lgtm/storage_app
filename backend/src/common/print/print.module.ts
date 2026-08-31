// common/print/print.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrintTokenService } from './print-token.service';

// Ownership rule: PrintTokenService is provided ONLY here. Any module that
// needs it imports PrintModule — never re-declares PrintTokenService in
// its own `providers`. Doing so creates a second, independently-scoped
// instance that won't see this module's JwtModule registration and will
// fail DI resolution at startup. (This has happened twice already —
// SalesQuotationModule and InvoiceModule both hit it before importing
// PrintModule correctly.)
@Module({
  imports: [JwtModule.register({})], // secret passed per-call in sign/verify, no default config needed
  providers: [PrintTokenService],
  exports: [PrintTokenService],
})
export class PrintModule {}