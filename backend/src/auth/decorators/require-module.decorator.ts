// src/auth/decorators/require-module.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';

export const REQUIRE_MODULE_KEY = 'requireModule';

/**
 * Gate a controller or route behind one or more purchased modules.
 * Passes if the org has AT LEAST ONE of the listed modules active.
 *
 * @example
 *   @RequireModule(ModuleKey.INVOICE_POS)
 *   @Controller('invoices')
 *   export class InvoiceController {}
 *
 * @example
 *   @RequireModule(ModuleKey.INVOICE_POS, ModuleKey.WORKSHOP_RMS)
 *   @Controller('customers')
 *   export class CustomersController {}
 */
export const RequireModule = (...modules: ModuleKey[]) =>
  SetMetadata(REQUIRE_MODULE_KEY, modules);