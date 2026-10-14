// src/shared/documents/document-number-format.util.ts
//
// Admin-configurable document number templates, e.g. "ATL-{SEQ:5}" or
// "INV/{YYYY}/{MM}/{SEQ}". Tokens:
//   {SEQ}    the running number, unpadded         -> 59887
//   {SEQ:n}  the running number, zero-padded to n -> {SEQ:5} = 00042
//   {YYYY} {YY} {MM} {DD}  the business date (org timezone)
// Everything outside braces is printed as-is.
//
// The running number is one counter per org (DocumentSequence.lastNumber)
// shared by every format — {YYYY} is only decoration, it never resets the
// count — so switching formats always continues where the last one stopped.
//
// Mirrored for the live preview in
// frontend/app/components/settings/InvoiceNumberingSettings.tsx.

export const MAX_FORMAT_LENGTH = 40;
const MAX_PAD = 10;

const TOKEN_RE = /\{([A-Z]+)(?::(\d+))?\}/g;

// Returns an error message, or null when the format is usable.
export function validateNumberFormat(format: string): string | null {
  if (!format.trim()) return 'Format is required';
  if (format.length > MAX_FORMAT_LENGTH) return `Format must be at most ${MAX_FORMAT_LENGTH} characters`;
  if (/[\u0000-\u001f\u007f]/.test(format)) return 'Format contains invalid characters';

  let seqCount = 0;
  for (const m of format.matchAll(TOKEN_RE)) {
    const [, name, pad] = m;
    if (name === 'SEQ') {
      seqCount++;
      if (pad !== undefined && (Number(pad) < 1 || Number(pad) > MAX_PAD)) {
        return `{SEQ:n} padding must be between 1 and ${MAX_PAD}`;
      }
    } else if (['YYYY', 'YY', 'MM', 'DD'].includes(name)) {
      if (pad !== undefined) return `{${name}} does not take a padding`;
    } else {
      return `Unknown token {${name}}`;
    }
  }
  // Leftover braces mean a typo like "{seq}" or "{SEQ" — reject rather
  // than print them literally on every invoice.
  if (/[{}]/.test(format.replace(TOKEN_RE, ''))) return 'Unrecognized { } in format';
  // Exactly one: without it every invoice gets the same number; with two
  // the same counter would just print twice.
  if (seqCount !== 1) return 'Format must contain {SEQ} exactly once';
  return null;
}

// `businessDate` is a Date at 00:00 UTC of the org's calendar date (see
// accounting/business-date.ts toBusinessDate), so the UTC getters read it.
export function renderNumberFormat(format: string, seq: number, businessDate: Date): string {
  const yyyy = String(businessDate.getUTCFullYear());
  const mm = String(businessDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(businessDate.getUTCDate()).padStart(2, '0');
  return format.replace(TOKEN_RE, (_, name: string, pad?: string) => {
    switch (name) {
      case 'SEQ':
        return pad ? String(seq).padStart(Number(pad), '0') : String(seq);
      case 'YYYY':
        return yyyy;
      case 'YY':
        return yyyy.slice(-2);
      case 'MM':
        return mm;
      case 'DD':
        return dd;
      default:
        return '';
    }
  });
}
