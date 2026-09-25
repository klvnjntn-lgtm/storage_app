'use client';

import { useRef, useState, } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { display } from '@/lib/fonts';
import { UploadCloud, Download, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import React from 'react'
import { useLanguage } from '@/app/context/LanguageContext';


// Shape of a row as it comes straight out of the sheet, before we coerce
// qty/sellingPrice/costPrice into numbers. Cells can be strings, numbers,
// or missing — Row (below) is the post-parse shape and shouldn't be used
// for sheet_to_json, since that told TypeScript raw cells already matched
// Row's number types, which is what caused the build failure here.
type RawRow = {
  sku: string;
  name: string;
  category: string;
  brand?: string;
  location: string;
  qty: string | number;
  sellingPrice?: string | number;
  costPrice?: string | number;
};

type Row = {
  sku: string;
  name: string;
  category: string;
  brand?: string;
  location: string;
  qty: number;
  sellingPrice?: number;
  costPrice?: number;
};

// Mirrors ImportMode in stock.service.ts — kept as a plain union here
// rather than importing across the frontend/backend boundary.
type ImportMode = 'REPLACE' | 'INCREMENT';

// Shape of each entry in the backend's `rejected` array — the row as
// submitted, plus why it failed.
type RejectedRow = Row & { reason: string };

const REQUIRED_COLUMNS = ['sku', 'name', 'category', 'location', 'qty'];

// Mirrors ProductService.validateLengths() on the backend — kept in
// sync manually since the frontend can't import backend code. If these
// limits change in product.service.ts, update them here too.
const MAX_LENGTHS = {
  sku: 100,
  name: 255,
  category: 100,
  brand: 100,
} as const;

// Returns the same rejection reason the backend would give for this
// row (as a translation-key code), or null if the row would pass
// ProductService's validation. Checked in the same order as the backend
// so the message matches. The code is turned into a localized message by
// rowErrorMessage() inside the page component.
function getValidationErrorCode(r: Row): string | null {
  const sku = r.sku?.toString().trim() ?? '';
  const name = r.name?.toString().trim() ?? '';
  const category = r.category?.toString().trim() ?? '';
  const brand = r.brand?.toString().trim();

  if (!name) return 'missingNameOrCategory';
  if (!category) return 'missingNameOrCategory';
  if (!sku) return 'missingSku';
  if (!(Number(r.qty) > 0)) return 'qtyMustBeGreaterThanZero';

  // Backend checks price sign before length limits — same order here.
  if (r.sellingPrice != null && r.sellingPrice < 0) return 'sellingPriceNegative';
  if (r.costPrice != null && r.costPrice < 0) return 'costPriceNegative';

  if (sku.length > MAX_LENGTHS.sku) return 'skuTooLong';
  if (name.length > MAX_LENGTHS.name) return 'nameTooLong';
  if (category.length > MAX_LENGTHS.category) return 'categoryTooLong';
  if (brand && brand.length > MAX_LENGTHS.brand) return 'brandTooLong';

  return null;
}

function isRowValid(r: Row) {
  return getValidationErrorCode(r) === null;
}

// Reads the current user's email straight out of the JWT payload for
// display purposes only — this is NOT auth/verification, just a label.
// The backend is the real source of truth for who performed the import
// (via userId on the created events).
function getCurrentUserEmail(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('accessToken');
  if (!token) return null;

  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const json = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json);
    return payload?.email ?? null;
  } catch {
    return null;
  }
}

export default function ImportPage() {
    const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  function rowErrorMessage(r: Row): string | null {
    const code = getValidationErrorCode(r);
    return code ? t(`upload.uploadPage.errors.${code}`) : null;
  }

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [columnError, setColumnError] = useState('');
  const [fileName, setFileName] = useState('');
  const [importResult, setImportResult] = useState<{
    accepted: number;
    rejected: RejectedRow[];
    importedBy: string | null;
  } | null>(null);
  const [importError, setImportError] = useState('');

  // No default — the person has to actively pick one. REPLACE and
  // INCREMENT leave stock in very different places for the same sheet,
  // so silently defaulting to either is how a stock opname accidentally
  // becomes a double-count, or a bulk receive accidentally wipes counts.
  const [mode, setMode] = useState<ImportMode | null>(null);

  const invalidCount = rows.filter((r) => !isRowValid(r)).length;
  const blankLocationCount = rows.filter((r) => !r.location?.toString().trim()).length;
  const canImport = rows.length > 0 && invalidCount === 0 && !columnError && !loading && mode !== null;

  function handleDownloadTemplate() {
    const templateData = [
      {
        sku: 'BJ-TY011',
        name: 'Ball Joint',
        category: 'BJ',
        brand: 'Toyota',
        location: 'Rack A1',
        qty: 5,
        sellingPrice: 150000,
        costPrice: 100000,
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock Import');
    XLSX.writeFile(workbook, 'stock-import-template.xlsx');
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // starting fresh with a new file — clear any old result/error state
    setImportResult(null);
    setImportError('');
    setFileName(file.name);

    const reader = new FileReader();

    // FIX — was no try/catch around XLSX.read()/sheet_to_json() and no
    // reader.onerror handler at all. Selecting a corrupt file, or a
    // non-Excel file with an .xlsx/.xls extension (the `accept`
    // attribute is only an advisory client hint, not a real check),
    // threw inside this callback with nothing to catch it — the UI
    // showed no error and gave no indication the upload failed.
    reader.onerror = () => {
      setColumnError(t('upload.uploadPage.couldNotReadFile'));
      setRows([]);
    };

    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });

        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '' });

        if (json.length === 0) {
          setColumnError(t('upload.uploadPage.excelFileEmpty'));
          setRows([]);
          return;
        }

      const headers = Object.keys(json[0]);

      const missing = REQUIRED_COLUMNS.filter(
        (c) => !headers.includes(c)
      );

      if (missing.length) {
        setColumnError(t('upload.uploadPage.missingColumns', { columns: missing.join(', ') }));
        setRows([]);
        return;
      }

      setColumnError('');
      setRows(
        json.map((r) => ({
          ...r,
          qty: Number(r.qty) || 0,
          // Blank cell -> undefined, not 0. A blank price column means
          // "don't touch pricing for this row," same as bulkImport()
          // on the backend only updating price fields it was actually
          // given.
          sellingPrice:
            r.sellingPrice === '' || r.sellingPrice == null
              ? undefined
              : Number(r.sellingPrice),
          costPrice:
            r.costPrice === '' || r.costPrice == null
              ? undefined
              : Number(r.costPrice),
        }))
      );
      } catch {
        setColumnError(t('upload.uploadPage.couldNotParseFile'));
        setRows([]);
      }
    };

    reader.readAsBinaryString(file);
  }

  const NUMERIC_FIELDS: (keyof Row)[] = ['qty', 'sellingPrice', 'costPrice'];

  function updateRow(index: number, field: keyof Row, value: string) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        if (!NUMERIC_FIELDS.includes(field)) return { ...r, [field]: value };
        // Blank price cell means "leave pricing alone," not zero —
        // an empty string here should stay undefined, not become 0.
        if (value === '' && field !== 'qty') return { ...r, [field]: undefined };
        return { ...r, [field]: Number(value) || 0 };
      })
    );
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function removeInvalidRows() {
    setRows((prev) => prev.filter((r) => isRowValid(r)));
  }

  async function handleImport() {
    if (!mode) return;

    setLoading(true);
    setImportError('');
    setImportResult(null);

    try {
      const payload = rows.map((r) => ({
        ...r,
        location: r.location?.toString().trim() || 'Unassigned',
      }));

      const res = await apiFetch(`/stock/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, rows: payload }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setImportError(data?.message || t('upload.uploadPage.importFailedWithStatus', { status: res.status }));
        return;
      }

      setImportResult({
        accepted: data?.accepted?.length ?? 0,
        rejected: Array.isArray(data?.rejected) ? data.rejected : [],
        importedBy: getCurrentUserEmail(),
      });

      // clear everything so there's nothing left to accidentally re-submit
      setRows([]);
      setFileName('');
      setColumnError('');
      setMode(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error(err);
      setImportError(t('upload.uploadPage.couldNotReachServer'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >

      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <UploadCloud size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('upload.uploadPage.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('upload.uploadPage.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 sm:space-y-6">

        {/* IMPORT RESULT */}
        {importResult && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl p-3 text-sm">
              <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
              <span>
                {t('upload.uploadPage.importComplete', { accepted: importResult.accepted, failed: importResult.rejected.length })}{' '}
                {t('upload.uploadPage.chooseNewFile')}
                {importResult.importedBy && (
                  <span className="block text-xs text-green-700 mt-1">
                    {t('upload.uploadPage.importedBy', { email: importResult.importedBy })}
                  </span>
                )}
              </span>
            </div>

            {importResult.rejected.length > 0 && (
              <div className="border border-red-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-red-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle size={14} strokeWidth={2} />
                  {importResult.rejected.length === 1
                    ? t('upload.uploadPage.rowsCouldNotBeAddedOne')
                    : t('upload.uploadPage.rowsCouldNotBeAddedMany', { count: importResult.rejected.length })}
                </div>
                {/* Reason text can run long — without overflow-x-auto here,
                    a narrow phone would just clip it since the parent uses
                    overflow-hidden. */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[420px]">
                    <thead className="bg-blue-50/60 border-b border-blue-500/15">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">SKU</th>
                        <th className="text-left px-3 py-2 font-semibold">{t('common.name')}</th>
                        <th className="text-left px-3 py-2 font-semibold">{t('upload.uploadPage.reason')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.rejected.map((r, i) => (
                        <tr
                          key={i}
                          className={`border-t border-blue-500/10 ${i % 2 === 1 ? 'bg-blue-50/20' : 'bg-white'}`}
                        >
                          <td className="px-3 py-2 font-medium">{r.sku || '-'}</td>
                          <td className="px-3 py-2">{r.name || '-'}</td>
                          <td className="px-3 py-2 text-red-700">{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {importError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
            <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {importError}
          </div>
        )}

        {/* IMPORT MODE */}
        <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
          <label className="block text-xs font-semibold text-gray-600">
            {t('upload.uploadPage.importModeChooseOne')}
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => setMode('REPLACE')}
              className={`flex-1 text-left border rounded-xl p-3 transition-colors ${
                mode === 'REPLACE'
                  ? 'border-blue-500/50 bg-blue-50/60'
                  : 'border-blue-500/15 hover:border-blue-500/35 hover:bg-blue-50/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                    mode === 'REPLACE' ? 'border-blue-600 bg-blue-600' : 'border-gray-400'
                  }`}
                />
                <span className="font-semibold text-sm">{t('upload.uploadPage.replaceQuantitiesTitle')}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 ml-5">
                {t('upload.uploadPage.replaceQuantitiesDescription')}
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMode('INCREMENT')}
              className={`flex-1 text-left border rounded-xl p-3 transition-colors ${
                mode === 'INCREMENT'
                  ? 'border-blue-500/50 bg-blue-50/60'
                  : 'border-blue-500/15 hover:border-blue-500/35 hover:bg-blue-50/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                    mode === 'INCREMENT' ? 'border-blue-600 bg-blue-600' : 'border-gray-400'
                  }`}
                />
                <span className="font-semibold text-sm">{t('upload.uploadPage.incrementQuantitiesTitle')}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1 ml-5">
                {t('upload.uploadPage.incrementQuantitiesDescription')}
              </p>
            </button>
          </div>
        </section>

        {/* UPLOAD SECTION */}
        <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                {t('upload.uploadPage.excelFile')}
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="text-sm w-full file:mr-3 file:px-3 file:py-2 file:rounded-md file:border file:border-blue-500/20 file:bg-white file:font-semibold file:cursor-pointer hover:file:bg-blue-50"
              />
            </div>

            <button
              onClick={handleDownloadTemplate}
              className="flex items-center justify-center gap-1.5 text-sm font-semibold border border-blue-500/20 text-blue-700 rounded-lg px-3 py-2.5 sm:py-2 hover:bg-blue-50 shrink-0 transition-colors"
            >
              <Download size={16} strokeWidth={2} />
              {t('upload.uploadPage.downloadTemplate')}
            </button>
          </div>

          {columnError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
              <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
              {columnError}
            </div>
          )}

          <p className="text-xs text-gray-500">
            {t('upload.uploadPage.requiredColumnsNote')}
          </p>
        </section>

        {/* PREVIEW / EDIT */}
        {rows.length > 0 && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                {t('upload.uploadPage.previewTapToEdit')}
              </h2>

              <div className="flex items-center gap-2 flex-wrap">
                {blankLocationCount > 0 && (
                  <span className="text-xs px-2 py-1 rounded-md bg-blue-50 border border-blue-500/20 text-blue-700">
                    {t('upload.uploadPage.willImportAsUnassigned', { count: blankLocationCount })}
                  </span>
                )}

                {invalidCount > 0 && (
                  <button
                    onClick={removeInvalidRows}
                    className="text-xs px-2 py-1 rounded-md border border-red-300 text-red-700 hover:bg-red-50 font-semibold transition-colors"
                  >
                    {invalidCount === 1
                      ? t('upload.uploadPage.removeInvalidRowOne')
                      : t('upload.uploadPage.removeInvalidRowMany', { count: invalidCount })}
                  </button>
                )}
              </div>
            </div>

            {invalidCount > 0 ? (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
                <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                {invalidCount === 1
                  ? t('upload.uploadPage.rowsNeedAttentionOne')
                  : t('upload.uploadPage.rowsNeedAttentionMany', { count: invalidCount })}
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">
                <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
                {rows.length === 1
                  ? t('upload.uploadPage.readyToImportOne', { fileName })
                  : t('upload.uploadPage.readyToImportMany', { fileName, count: rows.length })}
              </div>
            )}

            {rows.length > 0 && invalidCount === 0 && !mode && (
              <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-xl p-3 text-sm">
                <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                {t('upload.uploadPage.pickImportModeFirst')}
              </div>
            )}

            {/* Mobile: one card per row, every field stacked/grouped and
                easy to tap — a 9-column table has no room to breathe below
                sm, even with horizontal scroll, so it's swapped out
                entirely rather than just shrunk. */}
            <div className="sm:hidden flex flex-col gap-2">
              {rows.map((r, i) => {
                const rowError = rowErrorMessage(r);
                const valid = rowError === null;
                const blankLocation = !r.location?.toString().trim();
                const fieldClass =
                  'w-full border border-blue-500/20 rounded-md p-2 text-sm outline-none focus:border-blue-500/50 bg-white';

                return (
                  <div
                    key={i}
                    className={`border rounded-xl p-3 shadow-sm ${
                      !valid ? 'bg-red-50 border-red-300' : 'border-blue-500/15 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <label className="text-[10px] font-semibold text-gray-500">SKU</label>
                        <input
                          value={r.sku}
                          onChange={(e) => updateRow(i, 'sku', e.target.value)}
                          className={`${fieldClass} font-semibold`}
                        />
                      </div>
                      <button
                        onClick={() => removeRow(i)}
                        className="shrink-0 mt-5 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-600 transition-colors"
                        title={t('upload.uploadPage.removeRow')}
                      >
                        <Trash2 size={16} strokeWidth={2} />
                      </button>
                    </div>

                    <div className="mb-2">
                      <label className="text-[10px] font-semibold text-gray-500">{t('common.name')}</label>
                      <input
                        value={r.name}
                        onChange={(e) => updateRow(i, 'name', e.target.value)}
                        className={fieldClass}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500">{t('admin.database.entities.category.label')}</label>
                        <input
                          value={r.category}
                          onChange={(e) => updateRow(i, 'category', e.target.value)}
                          className={fieldClass}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500">{t('admin.database.entities.brand.label')}</label>
                        <input
                          value={r.brand ?? ''}
                          onChange={(e) => updateRow(i, 'brand', e.target.value)}
                          className={`${fieldClass} text-gray-600`}
                        />
                      </div>
                    </div>

                    <div className="mb-2">
                      <label className="text-[10px] font-semibold text-gray-500">{t('admin.database.entities.location.label')}</label>
                      <input
                        value={r.location}
                        onChange={(e) => updateRow(i, 'location', e.target.value)}
                        placeholder={t('upload.uploadPage.unassigned')}
                        className={`${fieldClass} ${blankLocation ? 'text-gray-400 italic' : ''}`}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500">{t('common.quantity')}</label>
                        <input
                          type="number"
                          value={r.qty}
                          onChange={(e) => updateRow(i, 'qty', e.target.value)}
                          className={`${fieldClass} font-bold`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500">{t('upload.uploadPage.sellPrice')}</label>
                        <input
                          type="number"
                          value={r.sellingPrice ?? ''}
                          placeholder="—"
                          onChange={(e) => updateRow(i, 'sellingPrice', e.target.value)}
                          className={fieldClass}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500">{t('upload.uploadPage.costPrice')}</label>
                        <input
                          type="number"
                          value={r.costPrice ?? ''}
                          placeholder="—"
                          onChange={(e) => updateRow(i, 'costPrice', e.target.value)}
                          className={`${fieldClass} text-gray-600`}
                        />
                      </div>
                    </div>

                    {rowError && (
                      <p className="flex items-start gap-1 text-xs text-red-700 mt-2">
                        <AlertCircle size={12} strokeWidth={2} className="shrink-0 mt-0.5" />
                        {rowError}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Tablet/desktop: original spreadsheet-style table */}
            <div className="hidden sm:block border border-blue-500/15 rounded-xl overflow-hidden overflow-x-auto bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-blue-50/60 border-b border-blue-500/15">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">SKU</th>
                    <th className="text-left px-3 py-2 font-semibold">{t('common.name')}</th>
                    <th className="text-left px-3 py-2 font-semibold">{t('admin.database.entities.category.label')}</th>
                    <th className="text-left px-3 py-2 font-semibold">{t('admin.database.entities.brand.label')}</th>
                    <th className="text-left px-3 py-2 font-semibold">{t('admin.database.entities.location.label')}</th>
                    <th className="text-left px-3 py-2 font-semibold">{t('common.quantity')}</th>
                    <th className="text-left px-3 py-2 font-semibold">{t('upload.uploadPage.sellPrice')}</th>
                    <th className="text-left px-3 py-2 font-semibold">{t('upload.uploadPage.costPrice')}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((r, i) => {
                    const rowError = rowErrorMessage(r);
                    const valid = rowError === null;
                    const blankLocation = !r.location?.toString().trim();

                    return (
                      // Fixed: shorthand fragments (<>...</>) can't take a
                      // key, so the key on the inner <tr> below was never
                      // actually attached to the list item React tracks
                      // (the fragment itself). Using an explicit
                      // React.Fragment with key={i} here fixes the
                      // "unique key prop" warning.
                      <React.Fragment key={i}>
                        <tr
                          className={`border-t border-blue-500/10 ${
                            !valid ? 'bg-red-50' : i % 2 === 1 ? 'bg-blue-50/20' : 'bg-white'
                          }`}
                        >
                          <td className="px-1 py-1">
                            <input
                              value={r.sku}
                              onChange={(e) => updateRow(i, 'sku', e.target.value)}
                              className="w-full bg-transparent border border-transparent focus:border-blue-500/40 focus:bg-white rounded px-2 py-1 text-sm outline-none font-medium"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              value={r.name}
                              onChange={(e) => updateRow(i, 'name', e.target.value)}
                              className="w-full bg-transparent border border-transparent focus:border-blue-500/40 focus:bg-white rounded px-2 py-1 text-sm outline-none"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              value={r.category}
                              onChange={(e) => updateRow(i, 'category', e.target.value)}
                              className="w-full bg-transparent border border-transparent focus:border-blue-500/40 focus:bg-white rounded px-2 py-1 text-sm outline-none"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              value={r.brand ?? ''}
                              onChange={(e) => updateRow(i, 'brand', e.target.value)}
                              className="w-full bg-transparent border border-transparent focus:border-blue-500/40 focus:bg-white rounded px-2 py-1 text-sm outline-none text-gray-600"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              value={r.location}
                              onChange={(e) => updateRow(i, 'location', e.target.value)}
                              placeholder={t('upload.uploadPage.unassigned')}
                              className={`w-full bg-transparent border rounded px-2 py-1 text-sm outline-none ${
                                blankLocation
                                  ? 'border-blue-500/20 text-gray-400 italic'
                                  : 'border-transparent focus:border-blue-500/40 focus:bg-white'
                              }`}
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              value={r.qty}
                              onChange={(e) => updateRow(i, 'qty', e.target.value)}
                              className="w-20 bg-transparent border border-transparent focus:border-blue-500/40 focus:bg-white rounded px-2 py-1 text-sm outline-none font-bold"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              value={r.sellingPrice ?? ''}
                              placeholder="—"
                              onChange={(e) => updateRow(i, 'sellingPrice', e.target.value)}
                              className="w-24 bg-transparent border border-transparent focus:border-blue-500/40 focus:bg-white rounded px-2 py-1 text-sm outline-none"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              value={r.costPrice ?? ''}
                              placeholder="—"
                              onChange={(e) => updateRow(i, 'costPrice', e.target.value)}
                              className="w-24 bg-transparent border border-transparent focus:border-blue-500/40 focus:bg-white rounded px-2 py-1 text-sm outline-none text-gray-600"
                            />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <button
                              onClick={() => removeRow(i)}
                              className="text-gray-400 hover:text-red-600 transition-colors"
                              title={t('upload.uploadPage.removeRow')}
                            >
                              <Trash2 size={16} strokeWidth={2} />
                            </button>
                          </td>
                        </tr>
                        {rowError && (
                          <tr className="bg-red-50">
                            <td colSpan={9} className="px-3 pb-2 -mt-1 text-xs text-red-700">
                              {rowError}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleImport}
                disabled={!canImport}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <UploadCloud size={18} strokeWidth={2} />
                {loading
                  ? t('upload.uploadPage.importing')
                  : rows.length === 1
                  ? t('upload.uploadPage.importButtonOne')
                  : t('upload.uploadPage.importButtonMany', { count: rows.length })}
              </button>
            </div>
          </section>
        )}

      </div>
    </main>
  );
}