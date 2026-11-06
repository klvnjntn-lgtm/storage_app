import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPastDate } from './dates';

describe('isPastDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 10:00 local on 15 Nov 2026.
    vi.setSystemTime(new Date(2026, 10, 15, 10, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts only days before today as past', () => {
    expect(isPastDate('2026-11-14')).toBe(true);
    expect(isPastDate('2026-11-15')).toBe(false);
    expect(isPastDate('2026-11-16')).toBe(false);
    expect(isPastDate('2025-12-31')).toBe(true);
  });

  it('treats a blank date as not past', () => {
    expect(isPastDate('')).toBe(false);
    expect(isPastDate(null)).toBe(false);
    expect(isPastDate(undefined)).toBe(false);
  });

  it('reads a stored ISO timestamp by its calendar date', () => {
    expect(isPastDate('2026-11-15T00:00:00.000Z')).toBe(false);
    expect(isPastDate('2026-11-14T00:00:00.000Z')).toBe(true);
  });
});
