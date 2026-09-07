// lib/plate.ts
//
// Shared plate-normalization logic. Use the SAME function on the backend
// (to populate a normalized column at write-time and to build the search
// WHERE clause) and on the frontend (only if you want to pre-check an
// exact match client-side before the debounced request lands).
//
// "BP 1234 XX", "bp1234xx", "BP-1234-XX" all normalize to "BP1234XX".

export function normalizePlate(input: string): string {
  return input
    .toUpperCase()
    .normalize('NFKC')
    .replace(/[^A-Z0-9]/g, '');
}