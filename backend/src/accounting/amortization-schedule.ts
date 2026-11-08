// Straight-line amortization schedule, as pure date and money arithmetic so it can be tested
// without a database. Dates are UTC-midnight date-only values (Prisma @db.Date).

export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// Clamped to the target month's last day: Jan 31 + 1 month is Feb 28, and the schedule keeps
// its day of the month afterwards (Mar 31, not Mar 28), because it's always counted from start.
export function addMonths(d: Date, months: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + months;
  const day = Math.min(d.getUTCDate(), daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

// Whole months from `from` up to `to`: Jan 15 -> Feb 15 is 1, Jan 15 -> Feb 14 is 0. A start on a
// day a shorter month doesn't have counts from that month's last day (Jan 31 -> Feb 28 is 1).
export function wholeMonthsBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  const anchor = Math.min(from.getUTCDate(), daysInMonth(to.getUTCFullYear(), to.getUTCMonth()));
  if (to.getUTCDate() < anchor) months -= 1;
  return Math.max(months, 0);
}

// The regular monthly charge, rounded to the cent. The last month takes whatever rounding left
// over, so the months always add up to exactly the cost.
export function monthlyAmount(cost: number, months: number): number {
  return round2(cost / months);
}

// Total amortized after `k` of `months` months.
export function cumulativeAfter(cost: number, months: number, k: number): number {
  if (k <= 0) return 0;
  if (k >= months) return round2(cost);
  return round2(monthlyAmount(cost, months) * k);
}

// The charge for month `k` (1-based).
export function chargeForMonth(cost: number, months: number, k: number): number {
  return round2(cumulativeAfter(cost, months, k) - cumulativeAfter(cost, months, k - 1));
}

export type ScheduleRow = {
  month: number;
  // The month's charge is booked on this date: one month after the previous one.
  date: Date;
  amount: number;
  accumulated: number;
  remaining: number;
};

export function buildSchedule(cost: number, months: number, startDate: Date): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  for (let k = 1; k <= months; k++) {
    const accumulated = cumulativeAfter(cost, months, k);
    rows.push({
      month: k,
      date: addMonths(startDate, k),
      amount: chargeForMonth(cost, months, k),
      accumulated,
      remaining: round2(cost - accumulated),
    });
  }
  return rows;
}

// How many months of the schedule have ended on or before `through` (capped at the life).
export function monthsDueThrough(startDate: Date, months: number, through: Date): number {
  return Math.min(wholeMonthsBetween(startDate, through), months);
}
