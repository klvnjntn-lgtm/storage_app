import { describe, expect, it } from 'vitest';
import { distanceMeters, pickFix, type TimedFix } from './pickFix';

// ~1.11 m per 0.00001° of latitude.
const at = (dLatM: number, accuracy: number | undefined, t: number): TimedFix => ({
  latitude: 1.1 + dLatM / 111_195,
  longitude: 104.0,
  accuracy,
  at: t,
});

describe('distanceMeters', () => {
  it('measures a north-south gap', () => {
    expect(distanceMeters(at(0, 5, 0), at(100, 5, 0))).toBeCloseTo(100, 0);
  });
});

describe('pickFix', () => {
  it('returns null with no readings', () => {
    expect(pickFix([])).toBeNull();
  });

  it('ignores a tighter reading from a spot the driver has left', () => {
    // On the road behind the customer (±5 m), then 60 m on at the gate (±12 m).
    const road = at(0, 5, 1000);
    const gate = at(60, 12, 9000);
    expect(pickFix([road, gate])).toBe(gate);
  });

  it('takes a tighter reading of the same spot', () => {
    const coarse = at(0, 15, 9000);
    const fine = at(4, 6, 5000);
    expect(pickFix([fine, coarse])).toEqual({ ...fine, at: 9000 });
  });

  it('ignores a tighter reading behind a weak latest one', () => {
    // Road ±5 m, then 60 m on at the gate with only ±70 m: the gate's circle
    // takes in the road, but the road is not where the driver is.
    const road = at(0, 5, 1000);
    const gate = at(60, 70, 4000);
    expect(pickFix([road, gate])).toBe(gate);
  });

  it('ignores a tighter reading of the same spot from too long ago', () => {
    const old = at(2, 4, 1000);
    const latest = at(0, 15, 10_000);
    expect(pickFix([old, latest])).toBe(latest);
  });

  it('takes the latest reading when it has no accuracy', () => {
    const fine = at(0, 3, 1000);
    const latest = at(2, undefined, 2000);
    expect(pickFix([fine, latest])).toBe(latest);
  });

  it('picks the latest by time, not by array order', () => {
    const newer = at(80, 10, 5000);
    const older = at(0, 4, 1000);
    expect(pickFix([newer, older])).toBe(newer);
  });
});
