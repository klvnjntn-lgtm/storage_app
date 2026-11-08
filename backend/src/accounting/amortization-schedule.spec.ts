import {
  addMonths,
  buildSchedule,
  chargeForMonth,
  cumulativeAfter,
  monthsDueThrough,
  wholeMonthsBetween,
} from './amortization-schedule';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe('amortization schedule', () => {
  it('spreads an even cost evenly', () => {
    const rows = buildSchedule(12_000_000, 12, d('2026-01-01'));
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.amount === 1_000_000)).toBe(true);
    expect(rows[11].accumulated).toBe(12_000_000);
    expect(rows[11].remaining).toBe(0);
  });

  it('puts the rounding remainder in the last month, so the months add up to the cost exactly', () => {
    const rows = buildSchedule(1_000_000, 3, d('2026-01-01'));
    expect(rows.map((r) => r.amount)).toEqual([333_333.33, 333_333.33, 333_333.34]);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(1_000_000, 2);
  });

  it('dates each month one month after the start, keeping the day of the month', () => {
    const rows = buildSchedule(300, 3, d('2026-01-31'));
    expect(rows.map((r) => iso(r.date))).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('counts only whole months as due', () => {
    expect(wholeMonthsBetween(d('2026-01-15'), d('2026-02-14'))).toBe(0);
    expect(wholeMonthsBetween(d('2026-01-15'), d('2026-02-15'))).toBe(1);
    expect(wholeMonthsBetween(d('2026-01-31'), d('2026-02-28'))).toBe(1);
    expect(monthsDueThrough(d('2026-01-01'), 12, d('2027-06-01'))).toBe(12);
    expect(monthsDueThrough(d('2026-03-01'), 12, d('2026-02-01'))).toBe(0);
  });

  it('a catch-up over several months charges exactly those months', () => {
    const cost = 1_000_000;
    const caughtUp = cumulativeAfter(cost, 3, 3) - cumulativeAfter(cost, 3, 1);
    expect(caughtUp).toBeCloseTo(chargeForMonth(cost, 3, 2) + chargeForMonth(cost, 3, 3), 2);
  });

  it('addMonths clamps to the end of a shorter month', () => {
    expect(iso(addMonths(d('2026-01-31'), 1))).toBe('2026-02-28');
    expect(iso(addMonths(d('2028-01-31'), 1))).toBe('2028-02-29');
  });
});
