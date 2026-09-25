// Access-hour window checks for DRIVER accounts. Mirrors the
// Intl.DateTimeFormat-based per-org timezone approach in
// accounting/business-date.ts rather than inventing a second timezone
// mechanism — see resolveTimezone() there.

import type { DriverAccessSchedule } from '@prisma/client';

const dowFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

type DayOfWeekStr = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

function getDowFormatter(tz: string): Intl.DateTimeFormat {
  let f = dowFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
    dowFormatters.set(tz, f);
  }
  return f;
}

function getTimeFormatter(tz: string): Intl.DateTimeFormat {
  let f = timeFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeFormatters.set(tz, f);
  }
  return f;
}

// en-US "Mon"/"Tue"/... maps directly onto our DayOfWeek enum values.
const WEEKDAY_LABEL_TO_DAY_OF_WEEK: Record<string, DayOfWeekStr> = {
  Sun: 'SUN',
  Mon: 'MON',
  Tue: 'TUE',
  Wed: 'WED',
  Thu: 'THU',
  Fri: 'FRI',
  Sat: 'SAT',
};

export function currentDayOfWeek(now: Date, tz: string): string {
  const label = getDowFormatter(tz).format(now);
  return WEEKDAY_LABEL_TO_DAY_OF_WEEK[label] ?? 'SUN';
}

export function currentHHmm(now: Date, tz: string): string {
  // en-GB with hourCycle 'h23' formats as "HH:mm".
  return getTimeFormatter(tz).format(now);
}

// No overnight-wrap support in v1 — a window is only valid same-day
// (startTime < endTime); see DriverAccessSchedule's schema comment.
export function isWithinAccessWindow(
  schedules: Pick<
    DriverAccessSchedule,
    'dayOfWeek' | 'startTime' | 'endTime'
  >[],
  now: Date,
  tz: string,
): boolean {
  if (schedules.length === 0) return true; // unrestricted — no rows configured
  const day = currentDayOfWeek(now, tz);
  const hhmm = currentHHmm(now, tz);
  return schedules.some(
    (s) => s.dayOfWeek === day && s.startTime <= hhmm && hhmm < s.endTime,
  );
}
