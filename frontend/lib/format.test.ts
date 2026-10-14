import { describe, expect, it } from 'vitest';
import { formatIDRCompact } from './format';
import { isDesktopRoute } from './desktop';

describe('formatIDRCompact', () => {
  it('abbreviates and keeps the sign in front', () => {
    expect(formatIDRCompact(12_345_678)).toBe('Rp 12.3jt');
    expect(formatIDRCompact(-1_500_000)).toBe('-Rp 1.5jt');
    expect(formatIDRCompact(2_500_000_000)).toBe('Rp 2.5M');
    expect(formatIDRCompact(45_000)).toBe('Rp 45rb');
  });
});

describe('isDesktopRoute', () => {
  it('keeps the desktop app to the selling side and hides cloud-only pages', () => {
    expect(isDesktopRoute('/sales/invoices/new')).toBe(true);
    expect(isDesktopRoute('/sales/orders')).toBe(false);
    expect(isDesktopRoute('/settings/billing')).toBe(false);
    expect(isDesktopRoute('/settings/whatsapp')).toBe(false);
    expect(isDesktopRoute('/settings/security')).toBe(true);
    expect(isDesktopRoute('/inventory')).toBe(false);
    expect(isDesktopRoute('/inventory/stock/123')).toBe(true);
  });
});
