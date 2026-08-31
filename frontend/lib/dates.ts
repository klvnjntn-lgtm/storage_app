// lib/dates.ts

// Parses a pure calendar date value into a local Date at local midnight.
// Accepts a bare date string ("2026-08-20"), a full ISO timestamp string
// ("2026-08-20T00:00:00.000Z" — what dueDate actually looks like once a
// backend Date field round-trips through JSON), or a live Date object
// (some callers' types are `string | Date`).
//
// All three are handled the same way: read the UTC calendar-day fields
// off whatever Date results from the input, then rebuild a local-midnight
// Date from those fields. This avoids two separate bugs:
//   - new Date(dateOnlyString) is parsed as UTC midnight, so reading it
//     back with *local* getters can roll the day backward in
//     negative-offset timezones.
//   - naively splitting a date string on '-' breaks the moment the string
//     has a time component ("...T00:00:00.000Z".split('-') does not
//     yield three clean numbers), producing an Invalid Date.
// Reading UTC getters off a Date built from ANY of these input shapes
// reliably recovers the intended calendar day in every case.
export function parseCalendarDate(date: string | Date): Date {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Formats a Date as a local "YYYY-MM-DD" string. Avoids toISOString(),
// which converts to UTC first and can roll the date backward or forward
// a day depending on the local offset.
export function toCalendarDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}