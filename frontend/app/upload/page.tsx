'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  ArrowLeft,
  UploadCloud,
  Download,
  AlertCircle,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

type Row = {
  sku: string;
  name: string;
  category: string;
  brand?: string;
  location: string;
  qty: number;
};

const REQUIRED_COLUMNS = ['sku', 'name', 'category', 'location', 'qty'];

function isRowValid(r: Row) {
  return (
    !!r.sku?.toString().trim() &&
    !!r.name?.toString().trim() &&
    !!r.category?.toString().trim() &&
    Number(r.qty) > 0
  );
}

export default function ImportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [columnError, setColumnError] = useState('');
  const [fileName, setFileName] = useState('');
  const [importResult, setImportResult] = useState<{ accepted: number; rejected: number } | null>(null);
  const [importError, setImportError] = useState('');

  const invalidCount = rows.filter((r) => !isRowValid(r)).length;
  const blankLocationCount = rows.filter((r) => !r.location?.toString().trim()).length;
  const canImport = rows.length > 0 && invalidCount === 0 && !columnError && !loading;

  function handleDownloadTemplate() {
    const templateData = [
      {
        sku: 'BJ-TY011',
        name: 'Ball Joint',
        category: 'BJ',
        brand: 'Toyota',
        location: 'Rack A1',
        qty: 5,
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

    reader.onload = (evt) => {
      const data = evt.target?.result;
      const workbook = XLSX.read(data, { type: 'binary' });

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '' });

      if (json.length === 0) {
        setColumnError('Excel file is empty');
        setRows([]);
        return;
      }

      const headers = Object.keys(json[0]);

      const missing = REQUIRED_COLUMNS.filter(
        (c) => !headers.includes(c)
      );

      if (missing.length) {
        setColumnError(`Missing columns: ${missing.join(', ')}`);
        setRows([]);
        return;
      }

      setColumnError('');
      setRows(
        json.map((r) => ({
          ...r,
          qty: Number(r.qty) || 0,
        }))
      );
    };

    reader.readAsBinaryString(file);
  }

  function updateRow(index: number, field: keyof Row, value: string) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index
          ? { ...r, [field]: field === 'qty' ? Number(value) || 0 : value }
          : r
      )
    );
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function removeInvalidRows() {
    setRows((prev) => prev.filter((r) => isRowValid(r)));
  }

  async function handleImport() {
    setLoading(true);
    setImportError('');
    setImportResult(null);

    try {
      const payload = rows.map((r) => ({
        ...r,
        location: r.location?.toString().trim() || 'Unassigned',
      }));

      const res = await apiFetch('http://localhost:3000/stock/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payload }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setImportError(data?.message || `Import failed (status ${res.status})`);
        return;
      }

      setImportResult({
        accepted: data?.accepted?.length ?? 0,
        rejected: data?.rejected?.length ?? 0,
      });

      // clear everything so there's nothing left to accidentally re-submit
      setRows([]);
      setFileName('');
      setColumnError('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error(err);
      setImportError('Could not reach the server — check the console for details.');
    } finally {
      setLoading(false);
    }
  }

return (
    <main className="min-h-screen bg-white text-black">

      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Scanner Hub
          </button>
          <div className="flex items-center gap-2">
            <UploadCloud size={22} strokeWidth={2} className="text-gray-700" />
            <div>
              <h1 className="text-2xl font-bold">Stock Import</h1>
              <p className="text-xs text-gray-500">Upload a stock sheet (SKU, qty, location)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto space-y-6">

        {/* IMPORT RESULT */}
        {importResult && (
          <div className="flex items-center gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
            <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
            Import complete — {importResult.accepted} added, {importResult.rejected} failed.
            Choose a new file below to import more.
          </div>
        )}

        {importError && (
          <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
            <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
            {importError}
          </div>
        )}

        {/* UPLOAD SECTION */}
        <section className="border-2 border-gray-300 rounded-md p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Excel file
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="text-sm file:mr-3 file:px-3 file:py-2 file:rounded-md file:border-2 file:border-gray-300 file:bg-white file:font-semibold file:cursor-pointer hover:file:bg-gray-100"
              />
            </div>

            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1.5 text-sm font-semibold border-2 border-gray-300 rounded-md px-3 py-2 hover:bg-gray-100"
            >
              <Download size={16} strokeWidth={2} />
              Download template
            </button>
          </div>

          {columnError && (
            <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
              <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
              {columnError}
            </div>
          )}

          <p className="text-xs text-gray-500">
            Required columns: sku, name, category, location, qty (brand is optional).
            Location can be left blank — it'll import as "Unassigned" and you can place it later.
          </p>
        </section>

        {/* PREVIEW / EDIT TABLE */}
        {rows.length > 0 && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                Preview — click any cell to edit
              </h2>

              <div className="flex items-center gap-3">
                {blankLocationCount > 0 && (
                  <span className="text-xs px-2 py-1 rounded-md bg-gray-100 border border-gray-300 text-gray-600">
                    {blankLocationCount} will import as Unassigned
                  </span>
                )}

                {invalidCount > 0 && (
                  <button
                    onClick={removeInvalidRows}
                    className="text-xs px-2 py-1 rounded-md border-2 border-red-300 text-red-700 hover:bg-red-50 font-semibold"
                  >
                    Remove {invalidCount} invalid row{invalidCount === 1 ? '' : 's'}
                  </button>
                )}
              </div>
            </div>

            {invalidCount > 0 ? (
              <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
                <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                {invalidCount} row{invalidCount === 1 ? '' : 's'} need sku, name, category, and a qty greater than 0 — fix them inline below, or remove them.
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-blue-50 border-2 border-blue-300 text-blue-800 rounded-md p-3 text-sm">
                <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
                {fileName} — all {rows.length} row{rows.length === 1 ? '' : 's'} ready to import
              </div>
            )}

            <div className="border-2 border-gray-300 rounded-md overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 border-b-2 border-gray-300">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">SKU</th>
                    <th className="text-left px-3 py-2 font-semibold">Name</th>
                    <th className="text-left px-3 py-2 font-semibold">Category</th>
                    <th className="text-left px-3 py-2 font-semibold">Brand</th>
                    <th className="text-left px-3 py-2 font-semibold">Location</th>
                    <th className="text-left px-3 py-2 font-semibold">Qty</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((r, i) => {
                    const valid = isRowValid(r);
                    const blankLocation = !r.location?.toString().trim();

                    return (
                      <tr
                        key={i}
                        className={`border-t border-gray-300 ${
                          !valid ? 'bg-red-50' : i % 2 === 1 ? 'bg-gray-50' : 'bg-white'
                        }`}
                      >
                        <td className="px-1 py-1">
                          <input
                            value={r.sku}
                            onChange={(e) => updateRow(i, 'sku', e.target.value)}
                            className="w-full bg-transparent border border-transparent focus:border-gray-400 focus:bg-white rounded px-2 py-1 text-sm outline-none font-medium"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            value={r.name}
                            onChange={(e) => updateRow(i, 'name', e.target.value)}
                            className="w-full bg-transparent border border-transparent focus:border-gray-400 focus:bg-white rounded px-2 py-1 text-sm outline-none"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            value={r.category}
                            onChange={(e) => updateRow(i, 'category', e.target.value)}
                            className="w-full bg-transparent border border-transparent focus:border-gray-400 focus:bg-white rounded px-2 py-1 text-sm outline-none"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            value={r.brand ?? ''}
                            onChange={(e) => updateRow(i, 'brand', e.target.value)}
                            className="w-full bg-transparent border border-transparent focus:border-gray-400 focus:bg-white rounded px-2 py-1 text-sm outline-none text-gray-600"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            value={r.location}
                            onChange={(e) => updateRow(i, 'location', e.target.value)}
                            placeholder="Unassigned"
                            className={`w-full bg-transparent border rounded px-2 py-1 text-sm outline-none ${
                              blankLocation
                                ? 'border-gray-300 text-gray-400 italic'
                                : 'border-transparent focus:border-gray-400 focus:bg-white'
                            }`}
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="number"
                            value={r.qty}
                            onChange={(e) => updateRow(i, 'qty', e.target.value)}
                            className="w-20 bg-transparent border border-transparent focus:border-gray-400 focus:bg-white rounded px-2 py-1 text-sm outline-none font-bold"
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            onClick={() => removeRow(i)}
                            className="text-gray-400 hover:text-red-600"
                            title="Remove row"
                          >
                            <Trash2 size={16} strokeWidth={2} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleImport}
                disabled={!canImport}
                className="flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-md font-semibold hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <UploadCloud size={18} strokeWidth={2} />
                {loading ? 'Importing...' : `Import ${rows.length} Row${rows.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </section>
        )}

      </div>
    </main>
  );

}