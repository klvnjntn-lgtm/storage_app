// Reads a bank's statement export. Every bank lays these out differently, so
// the user maps columns once on screen and this turns the rows into lines.

export type Cell = string | number | null | undefined;

export type StatementMapping = {
  headerRow: number; // index of the row holding column names
  date: number;
  description: number;
  // One signed amount column, or separate money-out / money-in columns.
  amount: number | null;
  debit: number | null;
  credit: number | null;
  // A separate "CR"/"DB" column some banks use beside an unsigned amount.
  direction: number | null;
  balance: number | null;
};

export type StatementLine = {
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  seq: number;
};

// Reads the first sheet of a CSV or Excel file into rows, values as written.
// raw: true matters: left to itself the reader "helps" by guessing, turning
// 03/11/2026 into 11 March and 250.000 into 250. Text stays text for the parsers
// below; a real Excel date or number cell stays a number, which they also read.
export async function readSheetRows(file: ArrayBuffer): Promise<Cell[][]> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(file, { type: 'array', raw: true, cellDates: false });
  const sheet = book.Sheets[book.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: '' });
}

// Banks export some cells with a leading apostrophe ('03/11, '0998) to stop
// Excel reformatting them, and files can start with a byte-order mark.
function cleanText(text: string): string {
  return text.replace(/^\uFEFF/, '').trim().replace(/^'+/, '').trim();
}

// Indonesian "1.000.000,50", international "1,000,000.50", plain "1000000",
// "(5.000)" and "-5.000" for money out, and a trailing CR/DB as BCA writes it.
// Null when there's no number here at all.
export function parseAmount(raw: Cell): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let text = cleanText(raw).toUpperCase().replace(/RP\.?/g, '').replace(/\s/g, '');
  if (!text || !/\d/.test(text)) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }
  const suffix = text.match(/(CR|DB|DR|K|D)$/);
  if (suffix) {
    if (suffix[1] === 'DB' || suffix[1] === 'DR' || suffix[1] === 'D') sign = -1;
    text = text.slice(0, -suffix[1].length);
  }
  if (text.startsWith('-')) {
    sign = -1;
    text = text.slice(1);
  } else if (text.endsWith('-')) {
    sign = -1;
    text = text.slice(0, -1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  if (!/^[\d.,]+$/.test(text)) return null;

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let decimal: string | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimal = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    // One kind of separator: it's a decimal point only when it appears once
    // and has 1 or 2 digits after it. "5.000" is five thousand.
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = text.split(sep);
    if (parts.length === 2 && parts[1].length <= 2) decimal = sep;
  }
  const digits = decimal
    ? text.slice(0, text.lastIndexOf(decimal)).replace(/[.,]/g, '') + '.' + text.slice(text.lastIndexOf(decimal) + 1)
    : text.replace(/[.,]/g, '');
  const value = Number(digits);
  return Number.isFinite(value) ? sign * Math.round(value * 100) / 100 : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, ags: 8,
  sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

function iso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Day comes first in Indonesian exports, so 03/11/2026 is 3 November. An Excel
// date number is read too. asOf (normally today) fills in a date with no year,
// as in "03/11": this year, unless that's still ahead, as "28/12" is when a
// December statement is imported in January.
export function parseStatementDate(raw: Cell, asOf?: string): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (raw < 20000 || raw > 80000) return null;
    const date = new Date(Math.round((raw - 25569) * 86400000));
    return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = cleanText(raw);
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = text.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (m && asOf) {
    const year = Number(asOf.slice(0, 4));
    const thisYear = iso(year, +m[2], +m[1]);
    return thisYear && thisYear > asOf ? iso(year - 1, +m[2], +m[1]) : thisYear;
  }
  return null;
}

const NAMES = {
  date: /^(tgl|tanggal|date|trans(action)?\s*date|posting\s*date)/i,
  description: /(keterangan|uraian|description|remark|narrative|berita|detail)/i,
  debit: /^(debet|debit|mutasi\s*debet|withdrawal|money\s*out|keluar)/i,
  credit: /^(kredit|credit|mutasi\s*kredit|deposit|money\s*in|masuk)/i,
  amount: /^(mutasi|jumlah|nominal|amount|nilai)/i,
  direction: /^(db\s*\/\s*cr|cr\s*\/\s*db|d\s*\/\s*k|k\s*\/\s*d|type|jenis|dk)$/i,
  balance: /^(saldo|balance|running)/i,
};

// A first guess: the row naming a date and a description column, then whichever
// columns its names point to. The user can correct all of it on screen.
export function guessMapping(rows: Cell[][]): StatementMapping {
  const named = (row: Cell[], re: RegExp) => row.findIndex((c) => typeof c === 'string' && re.test(cleanText(c)));
  let headerRow = rows.findIndex((row) => named(row, NAMES.date) >= 0 && named(row, NAMES.description) >= 0);
  if (headerRow < 0) headerRow = 0;
  const row = rows[headerRow] ?? [];
  const pick = (re: RegExp) => {
    const at = named(row, re);
    return at >= 0 ? at : null;
  };
  const debit = pick(NAMES.debit);
  const credit = pick(NAMES.credit);
  const split = debit != null && credit != null;
  // Some files put CR/DB in a column with no name, right beside the amount, so
  // it's recognised by what it holds.
  const body = rows.slice(headerRow + 1, headerRow + 21);
  const holdsDirection = (col: number) => {
    const values = body.map((r) => String(r[col] ?? '').trim().toUpperCase()).filter(Boolean);
    return values.length > 0 && values.every((v) => /^(CR|DB|DR|K|D)$/.test(v));
  };
  const amount = split ? null : pick(NAMES.amount);
  const namedDirection = split ? null : pick(NAMES.direction);
  const direction =
    namedDirection ?? (amount != null && holdsDirection(amount + 1) ? amount + 1 : null);
  return {
    headerRow,
    date: pick(NAMES.date) ?? 0,
    description: pick(NAMES.description) ?? 1,
    amount,
    debit: split ? debit : null,
    credit: split ? credit : null,
    direction,
    balance: pick(NAMES.balance),
  };
}

function signedAmount(row: Cell[], m: StatementMapping): number | null {
  if (m.debit != null || m.credit != null) {
    const out = m.debit != null ? parseAmount(row[m.debit]) : null;
    const into = m.credit != null ? parseAmount(row[m.credit]) : null;
    if (into) return Math.abs(into);
    if (out) return -Math.abs(out);
    return null;
  }
  if (m.amount == null) return null;
  const value = parseAmount(row[m.amount]);
  if (!value) return null;
  if (m.direction != null) {
    const flag = String(row[m.direction] ?? '').trim().toUpperCase();
    if (/^(DB|DR|D|DEBET|DEBIT)/.test(flag)) return -Math.abs(value);
    if (/^(CR|K|C|KREDIT|CREDIT)/.test(flag)) return Math.abs(value);
  }
  return value;
}

// Footer rows (totals, opening balance) have no date or no amount, so they're
// counted as skipped rather than imported.
export function readStatement(rows: Cell[][], m: StatementMapping, asOf?: string) {
  const seen = new Map<string, number>();
  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const row of rows.slice(m.headerRow + 1)) {
    if (!row || row.every((c) => c == null || c === '')) continue;
    const date = parseStatementDate(row[m.date], asOf);
    const amount = signedAmount(row, m);
    if (!date || !amount) {
      skipped += 1;
      continue;
    }
    const description = String(row[m.description] ?? '').trim().replace(/\s+/g, ' ').slice(0, 500);
    // The nth identical line, so two real Rp 5.000 fees on one day stay two.
    const key = `${date}|${amount}|${description.toLowerCase()}`;
    const seq = seen.get(key) ?? 0;
    seen.set(key, seq + 1);
    lines.push({ date, description, amount, balance: m.balance != null ? parseAmount(row[m.balance]) : null, seq });
  }
  return { lines, skipped };
}

export function monthBounds(date: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}` };
}
