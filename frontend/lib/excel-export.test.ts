import { describe, expect, it } from 'vitest';
import { fileNamePart, sheetName } from './excel-export';

describe('excel names', () => {
  it('cleans sheet names the way Excel requires', () => {
    expect(sheetName('Laba/Rugi: 2026')).toBe('Laba Rugi  2026');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
    expect(sheetName(' / ')).toBe('Sheet');
  });

  it('makes file name parts safe', () => {
    expect(fileNamePart('Cabang Timur / Batam')).toBe('Cabang-Timur-Batam');
    expect(fileNamePart('BCA •••1234')).toBe('BCA-1234');
  });
});
