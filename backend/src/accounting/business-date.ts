// Business calendar-date handling for the ledger.
//
// JournalEntry.entryDate is a @db.Date: Prisma stores the UTC calendar date
// of whatever JS Date it's given. Server-local getters (getMonth() etc.)
// disagree with that near month boundaries. Everything that decides an
// entry's date or fiscal period goes through these helpers instead, so the
// result is the same regardless of the server's own TZ.
//
// Timezone: ACCOUNTING_TIMEZONE env var (an IANA name), default Asia/Jakarta.
// Read lazily so it works whether or not .env was loaded before import.

import { BadRequestException } from '@nestjs/common';

function getTimezone(): string {
  return process.env.ACCOUNTING_TIMEZONE || 'Asia/Jakarta';
}

let dateFormatter: Intl.DateTimeFormat | null = null;
let dateFormatterTz: string | null = null;

function getDateFormatter(): Intl.DateTimeFormat {
  const tz = getTimezone();
  if (!dateFormatter || dateFormatterTz !== tz) {
    // Throws RangeError on an invalid zone name: fail loudly, not silently wrong.
    dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormatterTz = tz;
  }
  return dateFormatter;
}

// A Date at exactly 00:00:00.000 UTC is treated as a date-only value (what
// @db.Date columns and 'YYYY-MM-DD' strings produce) and keeps its UTC date.
// Anything else is an instant and is converted to the business timezone.
function isDateOnly(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

// Returns a Date at 00:00 UTC of the business calendar date, which is what
// a @db.Date column stores and what getUTCFullYear()/getUTCMonth() read back.
export function toBusinessDate(d: Date): Date {
  if (isDateOnly(d)) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const parts = getDateFormatter().formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

// "Today" in the business timezone: use this for default asOf/to values in
// report controllers instead of new Date().
export function todayBusinessDate(): Date {
  return toBusinessDate(new Date());
}

// Strict 'YYYY-MM-DD' -> Date at 00:00 UTC. Rejects anything else, including
// impossible dates like 2026-02-31, with a 400 naming the offending param.
export function parseDateOnly(value: string, name: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${name} must be a date in YYYY-MM-DD format`);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${name} is not a valid calendar date`);
  }
  return d;
}

// Offset of the business timezone from UTC at a given instant, in ms
// (positive east of UTC: Jakarta is +7h).
function tzOffsetMs(instant: Date): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: getTimezone(),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = f.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallAsUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

// The last instant (23:59:59.999) of a business calendar date, as a real
// UTC instant. Use for reports that compare against TIMESTAMP columns
// (invoice.issuedAt, supplierPayment.paidAt), so "as of Sep 30" includes
// something issued at 22:00 WIB that day. Two passes keep it right across
// DST zones; Asia/Jakarta has no DST.
export function endOfBusinessDay(dateOnly: Date): Date {
  const wall = Date.UTC(
    dateOnly.getUTCFullYear(),
    dateOnly.getUTCMonth(),
    dateOnly.getUTCDate(),
    23, 59, 59, 999,
  );
  let t = wall - tzOffsetMs(new Date(wall));
  t = wall - tzOffsetMs(new Date(t));
  return new Date(t);
}