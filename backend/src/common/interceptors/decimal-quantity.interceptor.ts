import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, map } from 'rxjs';

// Quantity columns are Decimal(12,2) so lines can hold 1.5 kg, but Prisma
// Decimals serialize to JSON strings ("2.00"). The frontend adds, compares
// and steps quantities as numbers, so a string would concatenate ("2" + 1 →
// "21") or never equal 0. Rather than wrap every invoice, session and order
// response by hand, this sends any Decimal under a quantity key as a number.
// Two decimals and 12 digits fit a double exactly, so nothing is lost.
// Money fields are left alone: they stay strings as before.
const QUANTITY_KEY = /^(quantity|qty|[a-z]+Quantity)$/;
const MAX_DEPTH = 12;

function convert(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => convert(v, depth + 1));
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = QUANTITY_KEY.test(k) && Prisma.Decimal.isDecimal(v) ? Number(v) : convert(v, depth + 1);
  }
  return out;
}

export function quantitiesToNumbers(body: unknown): unknown {
  return convert(body, 0);
}

@Injectable()
export class DecimalQuantityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    return next.handle().pipe(map((body) => quantitiesToNumbers(body)));
  }
}
