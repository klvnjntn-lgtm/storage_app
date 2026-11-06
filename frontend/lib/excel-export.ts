// Spreadsheet downloads for reports. xlsx is imported on demand so report
// pages don't carry it until someone actually downloads.

export type ExcelCell = string | number | null | undefined;

export type ExcelSheet = {
  name: string;
  rows: ExcelCell[][];
  // Column indexes shown with thousands separators. Values stay real numbers,
  // and text stays text, so a 16-digit NPWP isn't mangled into scientific.
  money?: number[];
  widths?: number[];
};

export type ExcelFile = { fileName: string; sheets: ExcelSheet[] };

// Excel refuses these in a sheet name, and anything past 31 characters.
export function sheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
}

// Safe in a file name on every OS, and readable: "Cabang Timur" → "Cabang-Timur".
export function fileNamePart(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

export async function downloadExcel({ fileName, sheets }: ExcelFile) {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const { name, rows, money = [], widths } of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(rows.map((row) => row.map((cell) => cell ?? '')));
    if (widths) sheet['!cols'] = widths.map((wch) => ({ wch }));
    rows.forEach((_, r) => {
      for (const c of money) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell?.t === 'n') cell.z = '#,##0';
      }
    });
    // Two sheets with one name would fail the whole download.
    let unique = sheetName(name);
    for (let n = 2; used.has(unique); n++) unique = `${sheetName(name).slice(0, 28)} ${n}`;
    used.add(unique);
    XLSX.utils.book_append_sheet(book, sheet, unique);
  }
  XLSX.writeFile(book, fileName);
}
