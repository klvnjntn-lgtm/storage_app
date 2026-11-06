import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { guessMapping, parseAmount, parseStatementDate, readSheetRows, readStatement } from './bank-statement';

describe('parseAmount', () => {
  it.each([
    ['1.000.000,50', 1000000.5],
    ['1,000,000.50', 1000000.5],
    ['5.000', 5000],
    ['5,000', 5000],
    ['5000', 5000],
    ['12,5', 12.5],
    ['12.50', 12.5],
    ['Rp 2.500', 2500],
    ['1,000,000', 1000000],
    ['1.000.000', 1000000],
  ])('%s', (raw, want) => expect(parseAmount(raw)).toBe(want));

  it('reads money out however it is written', () => {
    expect(parseAmount('-5.000')).toBe(-5000);
    expect(parseAmount('5.000-')).toBe(-5000);
    expect(parseAmount('(5.000)')).toBe(-5000);
    expect(parseAmount('2,500,000.00 DB')).toBe(-2500000);
    expect(parseAmount('2,500,000.00 CR')).toBe(2500000);
    expect(parseAmount(-20)).toBe(-20);
  });

  it('returns null for anything without a number', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount('Saldo')).toBeNull();
    expect(parseAmount('12 Jan')).toBeNull();
  });
});

describe('parseStatementDate', () => {
  it('reads day first, as Indonesian exports do', () => {
    expect(parseStatementDate('03/11/2026')).toBe('2026-11-03');
    expect(parseStatementDate('03-11-26')).toBe('2026-11-03');
    expect(parseStatementDate('2026-11-03')).toBe('2026-11-03');
    expect(parseStatementDate('2026-11-03 14:22:01')).toBe('2026-11-03');
  });

  it('reads month names in both languages', () => {
    expect(parseStatementDate('3 Agu 2026')).toBe('2026-08-03');
    expect(parseStatementDate('3 Mei 2026')).toBe('2026-05-03');
    expect(parseStatementDate('03-Dec-2026')).toBe('2026-12-03');
    expect(parseStatementDate('3 Desember 2026')).toBe('2026-12-03');
  });

  it('fills in a missing year, without landing in the future', () => {
    expect(parseStatementDate('03/11', '2026-11-20')).toBe('2026-11-03');
    expect(parseStatementDate('28/12', '2027-01-05')).toBe('2026-12-28');
    expect(parseStatementDate('03/11')).toBeNull();
  });

  it('ignores the apostrophe banks put in front of cells', () => {
    expect(parseStatementDate("'03/11", '2026-11-20')).toBe('2026-11-03');
    expect(parseAmount("'250,000.00")).toBe(250000);
  });

  it('reads an Excel date number, and refuses nonsense', () => {
    expect(parseStatementDate(46329)).toBe('2026-11-03');
    expect(parseStatementDate(5)).toBeNull();
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementDate('Saldo Awal')).toBeNull();
  });
});

describe('readStatement', () => {
  const split = [
    ['PT Contoh', '', '', '', ''],
    ['Periode', 'Nov 2026', '', '', ''],
    ['Tanggal', 'Keterangan', 'Debet', 'Kredit', 'Saldo'],
    ['01/11/2026', 'TRSF  MASUK', '', '100.000', '600.000'],
    ['02/11/2026', 'BIAYA ADM', '5.000', '', '595.000'],
    ['02/11/2026', 'BIAYA ADM', '5.000', '', '590.000'],
    ['', 'SALDO AKHIR', '', '', '590.000'],
  ];

  it('finds the header below a title block and picks the split columns', () => {
    expect(guessMapping(split)).toMatchObject({ headerRow: 2, date: 0, description: 1, debit: 2, credit: 3, amount: null, balance: 4 });
  });

  it('reads lines, signs them, numbers repeats, and skips footers', () => {
    const { lines, skipped } = readStatement(split, guessMapping(split));
    expect(lines.map((l) => l.amount)).toEqual([100000, -5000, -5000]);
    expect(lines[0].description).toBe('TRSF MASUK');
    expect(lines.map((l) => l.seq)).toEqual([0, 0, 1]);
    expect(lines[2].balance).toBe(590000);
    expect(skipped).toBe(1);
  });

  it('uses a separate CR/DB column beside one amount', () => {
    const rows = [
      ['Tanggal', 'Keterangan', 'Mutasi', 'DB/CR'],
      ['01/11/2026', 'A', '100.000', 'CR'],
      ['02/11/2026', 'B', '5.000', 'DB'],
    ];
    const m = guessMapping(rows);
    expect(m).toMatchObject({ amount: 2, direction: 3, debit: null });
    expect(readStatement(rows, m).lines.map((l) => l.amount)).toEqual([100000, -5000]);
  });

  it('reads a CR/DB suffix inside the amount, BCA style', () => {
    const rows = [
      ['Tanggal', 'Keterangan', 'Mutasi', 'Saldo'],
      ['01/11', 'A', '100,000.00 CR', '600,000.00'],
      ['02/11', 'B', '5,000.00 DB', '595,000.00'],
    ];
    const { lines } = readStatement(rows, guessMapping(rows), '2026-11-20');
    expect(lines.map((l) => [l.date, l.amount])).toEqual([['2026-11-01', 100000], ['2026-11-02', -5000]]);
  });
});

// Layouts modelled on what's publicly known of these banks' exports, read through
// the real spreadsheet library. No bank publishes a spec and none of these came
// from an actual download, so they guard against known shapes, not every file.
describe('whole files', () => {
  const asBuffer = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
  const read = async (file: ArrayBuffer) => {
    const rows = await readSheetRows(file);
    return readStatement(rows, guessMapping(rows), '2026-11-20');
  };

  it('title block, apostrophes, CR/DB in an unnamed column, pending and footer rows', async () => {
    const { lines, skipped } = await read(
      asBuffer(
        [
          'Informasi Rekening - Mutasi Rekening',
          "No. rekening : ,'1234567890",
          "Periode : ,'01/11/2026 - 30/11/2026",
          '',
          'Tanggal Transaksi,Keterangan,Cabang,Jumlah,,Saldo',
          `'02/11,TRSF E-BANKING CR 0211/FTSCY PT PELANGGAN,'0998,"250,000.00",CR,"750,000.00"`,
          `'03/11,BIAYA ADM,'0000,"10,000.00",DB,"740,000.00"`,
          `PEND,TRSF BELUM DIPROSES,'0000,"5,000.00",DB,"740,000.00"`,
          'Saldo Awal,,,,,"500,000.00"',
        ].join('\n'),
      ),
    );
    expect(lines.map((l) => [l.date, l.amount, l.balance])).toEqual([
      ['2026-11-02', 250000, 750000],
      ['2026-11-03', -10000, 740000],
    ]);
    expect(skipped).toBe(2);
  });

  it('credit before debit, Indonesian numbers, and ambiguous day-first dates', async () => {
    const { lines } = await read(
      asBuffer(
        [
          'TANGGAL,URAIAN,KETERANGAN,KREDIT,DEBIT,SALDO',
          '03/11/2026,SETORAN,PT A,"1.000.000,00",,"1.000.000,00"',
          '11/03/2026,BIAYA,ADM,,"250.000","750.000"',
        ].join('\n'),
      ),
    );
    expect(lines.map((l) => [l.date, l.amount, l.balance])).toEqual([
      ['2026-11-03', 1000000, 1000000],
      ['2026-03-11', -250000, 750000],
    ]);
    expect(lines[0].description).toBe('SETORAN');
  });

  it('English headers with two-digit years, and a repeated column name', async () => {
    const { lines } = await read(
      asBuffer(
        [
          'Account No,Date,Val. Date,Transaction Code,Description,Description,Reference No.,Debit,Credit,',
          '1234567,02/11/26,02/11/26,1234,Transfer In,PT A,REF1,0.00,"250,000.00",',
          '1234567,03/11/26,03/11/26,5678,Admin Fee,,REF2,"10,000.00",0.00,',
        ].join('\n'),
      ),
    );
    expect(lines.map((l) => [l.date, l.amount])).toEqual([['2026-11-02', 250000], ['2026-11-03', -10000]]);
  });

  it('semicolons, a byte-order mark, and quoted money', async () => {
    const { lines } = await read(
      asBuffer('\uFEFFTanggal;Keterangan;Debet;Kredit;Saldo\n02/11/2026;MASUK;;"250.000,00";"250.000,00"\n'),
    );
    expect(lines.map((l) => [l.date, l.amount])).toEqual([['2026-11-02', 250000]]);
  });

  it('a real Excel file with date and number cells', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Tanggal', 'Keterangan', 'Debet', 'Kredit', 'Saldo'],
      [new Date(Date.UTC(2026, 10, 3)), 'MASUK', '', 250000, 250000],
      [new Date(Date.UTC(2026, 10, 4)), 'BIAYA', 10000.5, '', 239999.5],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Mutasi');
    const file = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { lines } = await read(file);
    expect(lines.map((l) => [l.date, l.amount])).toEqual([['2026-11-03', 250000], ['2026-11-04', -10000.5]]);
  });
});
