import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

// Cost data (what the org pays for stock) is admin-only. ProductService
// already leaves costPrice out of the product list for non-admins, but a
// product row is embedded in many other responses (invoice and sales-order
// drafts, delivery orders, product detail, barcode lookup, ...), and document
// lines carry the same number as unitCost. Rather than chase every include,
// this strips both keys from any response sent to a signed-in non-admin.
//
// Exceptions:
// - Purchasing routes, where unitCost is the purchase price staff are
//   entering and reviewing, not hidden margin data.
// - Requests with no user (public routes, e.g. the print views Puppeteer
//   loads) — those never carry cost data on screen and are token-scoped.
const COST_KEYS = new Set(['costPrice', 'unitCost']);
const PURCHASING_PATH = /^\/(purchase-orders|receive|supplier-payments|suppliers)(\/|$)/;
const MAX_DEPTH = 12;

function redact(value: unknown, keys: Set<string>, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, keys, depth + 1));
  // Only walk plain objects; Dates, Prisma Decimals, Buffers and the like
  // serialize themselves and must be passed through untouched.
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (keys.has(k)) continue;
    out[k] = redact(v, keys, depth + 1);
  }
  return out;
}

export function redactCostFields(body: unknown, path: string): unknown {
  const keys = PURCHASING_PATH.test(path) ? new Set(['costPrice']) : COST_KEYS;
  return redact(body, keys, 0);
}

@Injectable()
export class RedactCostInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{ user?: { role?: string }; path?: string }>();
    const role = req.user?.role;
    if (!role || role === 'ADMIN') return next.handle();
    const path = req.path ?? '';
    return next.handle().pipe(map((body) => redactCostFields(body, path)));
  }
}
