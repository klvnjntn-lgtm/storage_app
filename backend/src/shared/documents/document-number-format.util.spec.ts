import { renderNumberFormat, validateNumberFormat } from './document-number-format.util';

describe('document number format', () => {
  const date = new Date(Date.UTC(2026, 2, 7)); // 7 Mar 2026

  it('renders padded and unpadded running numbers', () => {
    expect(renderNumberFormat('ATL-{SEQ:5}', 42, date)).toBe('ATL-00042');
    expect(renderNumberFormat('ATL - {SEQ}', 59887, date)).toBe('ATL - 59887');
    expect(renderNumberFormat('X{SEQ:2}', 12345, date)).toBe('X12345'); // padding never truncates
  });

  it('renders date tokens', () => {
    expect(renderNumberFormat('INV-{YYYY}-{SEQ:5}', 3, date)).toBe('INV-2026-00003');
    expect(renderNumberFormat('{YY}{MM}{DD}/{SEQ}', 9, date)).toBe('260307/9');
  });

  it('accepts valid formats', () => {
    for (const f of ['ATL-{SEQ:5}', 'INV-{YYYY}-{SEQ:5}', '{SEQ}', 'INV/{YY}/{MM}/{SEQ:4}']) {
      expect(validateNumberFormat(f)).toBeNull();
    }
  });

  it('rejects unusable formats', () => {
    expect(validateNumberFormat('')).toMatch(/required/);
    expect(validateNumberFormat('ATL-')).toMatch(/exactly once/);
    expect(validateNumberFormat('{SEQ}-{SEQ}')).toMatch(/exactly once/);
    expect(validateNumberFormat('ATL-{seq}')).toMatch(/Unrecognized/);
    expect(validateNumberFormat('ATL-{SEQ')).toMatch(/Unrecognized/);
    expect(validateNumberFormat('{FOO}{SEQ}')).toMatch(/Unknown token/);
    expect(validateNumberFormat('{SEQ:0}')).toMatch(/padding/);
    expect(validateNumberFormat('{SEQ:11}')).toMatch(/padding/);
    expect(validateNumberFormat('{YYYY:2}{SEQ}')).toMatch(/padding/);
    expect(validateNumberFormat('A'.repeat(41) + '{SEQ}')).toMatch(/at most/);
  });
});
