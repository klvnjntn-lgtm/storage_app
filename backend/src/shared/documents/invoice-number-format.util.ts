// src/shared/documents/invoice-number-format.util.ts
//
// Single source of truth for "prefix + trailing number" detection.
// Imported by BOTH gdb-import.service.ts (runs during every import) and
// scripts/backfill-invoice-sequences.ts (one-off backfill for orgs that
// were imported before this existed) — having two separate copies is
// exactly what let a bug drift undetected before (see the ATL-/ATL -
// whitespace-splitting issue this version fixes).

export interface DetectedInvoiceNumberFormat {
  prefix: string;
  lastNumber: number;
}

const TRAILING_NUMBER_REGEX = /^(.*?)(\d+)\s*$/;

// Merges spacing variants of the same prefix ("ATL-", "ATL -", "ATL  -")
// into one grouping key, so real-world inconsistent export formatting
// doesn't split one logical series into multiple competing buckets.
function normalizePrefixKey(prefix: string): string {
  return prefix.replace(/\s+/g, '').toUpperCase();
}

// Splits e.g. "ATL - 59884" into prefix "ATL - " + numeric 59884, then
// picks the MOST COMMON prefix (by row count) across all invoice numbers
// so a handful of stray/legacy-format numbers don't throw off detection.
//
// Whitespace variants of what's really the same series are merged before
// picking a winner — "ATL-" and "ATL - " count toward the SAME bucket,
// and within that bucket, whichever variant has the highest number wins
// the canonical formatting (on the assumption that the highest-numbered
// entries reflect whatever spacing convention is currently in use).
export function detectInvoiceNumberFormat(invoiceNumbers: (string | null | undefined)[]): DetectedInvoiceNumberFormat | null {
  const buckets = new Map<string, { prefix: string; lastNumber: number; count: number }>();

  for (const raw of invoiceNumbers) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const match = TRAILING_NUMBER_REGEX.exec(trimmed);
    if (!match) continue;
    const n = parseInt(match[2], 10);
    if (Number.isNaN(n)) continue;

    const rawPrefix = match[1];
    const key = normalizePrefixKey(rawPrefix);
    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, { prefix: rawPrefix, lastNumber: n, count: 1 });
    } else {
      existing.count += 1;
      if (n > existing.lastNumber) {
        existing.lastNumber = n;
        existing.prefix = rawPrefix;
      }
    }
  }

  if (buckets.size === 0) return null;

  let best: { prefix: string; lastNumber: number; count: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }

  return { prefix: best!.prefix, lastNumber: best!.lastNumber };
}