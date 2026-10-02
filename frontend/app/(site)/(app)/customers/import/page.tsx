'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { display } from '@/lib/fonts';
import { FileSpreadsheet, Download, Upload, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useHasModule } from '@/lib/hooks/useHasModule';
import { usePriceLevels } from '@/lib/price-levels';

type Field =
  | 'name'
  | 'companyName'
  | 'phone'
  | 'address'
  | 'npwp'
  | 'priceLevel'
  | 'latitude'
  | 'longitude'
  | 'coordinates'
  | 'deliveryNotes';

// Header spellings accepted per field, compared after lowercasing and
// dropping everything but letters/digits — so the template's English or
// Indonesian headers, and common hand-made variants, all map the same.
const HEADER_ALIASES: Record<Field, string[]> = {
  name: ['name', 'nama', 'customer', 'customername', 'namapelanggan', 'pelanggan'],
  companyName: ['company', 'companyname', 'perusahaan', 'namaperusahaan', 'toko', 'namatoko'],
  phone: ['phone', 'phonenumber', 'telepon', 'telp', 'notelp', 'notelepon', 'nohp', 'hp', 'whatsapp', 'wa', 'mobile'],
  address: ['address', 'alamat'],
  npwp: ['npwp', 'taxid'],
  priceLevel: ['pricelevel', 'levelharga', 'tingkatharga'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lng', 'lon', 'long'],
  coordinates: ['coordinates', 'koordinat', 'location', 'lokasi', 'latlng'],
  deliveryNotes: ['deliverynotes', 'notes', 'catatan', 'catatanpengiriman', 'directions', 'arahan'],
};

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

const MAX_ROWS = 5000;
// Keep each request under the backend's default 100kb JSON body limit.
const BATCH_BYTES = 80_000;
const BATCH_MAX_ROWS = 1000;
// Rendering thousands of table rows is slow on a phone; problems sort first.
const PREVIEW_LIMIT = 300;

// Same limits as the backend's ImportCustomerRowDto.
const MAX_LEN: Partial<Record<Field, number>> = {
  name: 200,
  companyName: 200,
  phone: 50,
  address: 500,
  npwp: 30,
  deliveryNotes: 1000,
  priceLevel: 100,
};

type Row = {
  excelRow: number;
  name: string;
  companyName: string;
  phone: string;
  address: string;
  npwp: string;
  priceLevel: string;
  latitude: number | null;
  longitude: number | null;
  deliveryNotes: string;
  problems: string[];
};

type Skipped = { excelRow: number; name: string; reason: string };
type Result = { created: number; skipped: Skipped[] };

export default function CustomerImportPage() {
  const { t } = useLanguage();
  // Bulk import is admin-only (the backend refuses staff too).
  const { authorized } = useRequireAdmin();
  const hasDelivery = useHasModule('DELIVERY_DMS');
  const { levels } = usePriceLevels();
  const showPriceLevel = levels.length > 1;

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const templateFields: Field[] = [
    'name',
    'companyName',
    'phone',
    'address',
    'npwp',
    ...(showPriceLevel ? (['priceLevel'] as Field[]) : []),
    ...(hasDelivery ? (['latitude', 'longitude', 'deliveryNotes'] as Field[]) : []),
  ];
  const header = (f: Field) => t(`customers.importPage.header.${f}`);

  function handleDownloadTemplate() {
    const example: Record<string, string | number> = {};
    for (const f of templateFields) {
      example[header(f)] =
        f === 'name' || f === 'companyName' || f === 'address' || f === 'deliveryNotes'
          ? t(`customers.importPage.example.${f}`)
          : f === 'phone'
            ? '081234567890'
            : f === 'priceLevel'
              ? (levels[0]?.name ?? '')
              : f === 'latitude'
                ? 3.5952
                : f === 'longitude'
                  ? 98.6722
                  : '';
    }
    const sheet = XLSX.utils.json_to_sheet([example], { header: templateFields.map(header) });
    sheet['!cols'] = templateFields.map((f) => ({ wch: f === 'address' || f === 'deliveryNotes' ? 40 : 20 }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Customers');
    XLSX.writeFile(book, 'customer-import-template.xlsx');
  }

  function validate(r: Omit<Row, 'problems'>, rawLat: string, rawLng: string, rawCoords: string): string[] {
    const p: string[] = [];
    if (!r.name) p.push(t('customers.importPage.problem.nameRequired'));
    for (const [f, max] of Object.entries(MAX_LEN) as [Field, number][]) {
      const v = r[f as keyof typeof r];
      if (typeof v === 'string' && v.length > max) {
        p.push(t('customers.importPage.problem.tooLong', { field: header(f), max }));
      }
    }
    if (rawCoords && r.latitude == null) p.push(t('customers.importPage.problem.badCoordinates'));
    if (rawLat && (r.latitude == null || r.latitude < -90 || r.latitude > 90)) p.push(t('customers.importPage.problem.badLatitude'));
    if (rawLng && (r.longitude == null || r.longitude < -180 || r.longitude > 180)) p.push(t('customers.importPage.problem.badLongitude'));
    if (!rawCoords && !!rawLat !== !!rawLng) p.push(t('customers.importPage.problem.incompleteLocation'));
    if (r.priceLevel && levels.length > 0 && !levels.some((l) => l.name.trim().toLowerCase() === r.priceLevel.toLowerCase())) {
      p.push(t('customers.importPage.problem.unknownPriceLevel', { name: r.priceLevel }));
    }
    return p;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileName(file.name);
    setRows([]);
    setFileError(null);
    setResult(null);
    setImportError(null);

    let raw: Record<string, unknown>[];
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      // raw:false → cells as displayed text, so phone/NPWP keep their formatting.
      raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
    } catch {
      setFileError(t('customers.importPage.readError'));
      return;
    }
    if (raw.length === 0) {
      setFileError(t('customers.importPage.noRows'));
      return;
    }

    // Map this file's headers onto fields.
    const colFor: Partial<Record<Field, string>> = {};
    for (const h of Object.keys(raw[0])) {
      const n = normHeader(h);
      for (const [f, aliases] of Object.entries(HEADER_ALIASES) as [Field, string[]][]) {
        if (!colFor[f] && aliases.includes(n)) colFor[f] = h;
      }
    }
    if (!colFor.name) {
      setFileError(t('customers.importPage.noNameColumn'));
      return;
    }

    const cell = (r: Record<string, unknown>, f: Field) =>
      colFor[f] ? String(r[colFor[f]!] ?? '').trim() : '';
    // Excel turns a typed 0812… into the number 812…; put the 0 back on
    // what is clearly an Indonesian mobile number.
    const fixPhone = (s: string) => (/^8\d{8,11}$/.test(s) ? `0${s}` : s);
    const num = (s: string) => {
      if (!s) return null;
      const n = Number(s.replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };

    const parsed: Row[] = [];
    raw.forEach((r, i) => {
      const values = (Object.keys(colFor) as Field[]).map((f) => cell(r, f));
      if (values.every((v) => !v)) return; // blank line
      const rawLat = cell(r, 'latitude');
      const rawLng = cell(r, 'longitude');
      const rawCoords = cell(r, 'coordinates');
      let latitude = num(rawLat);
      let longitude = num(rawLng);
      // "lat, lng" as copied from Google Maps.
      if (rawCoords && !rawLat && !rawLng) {
        const m = rawCoords.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
        latitude = m ? Number(m[1]) : null;
        longitude = m ? Number(m[2]) : null;
      }
      const base = {
        // SheetJS's own 0-based sheet row survives skipped blank lines.
        excelRow: ((r as { __rowNum__?: number }).__rowNum__ ?? i + 1) + 1,
        name: cell(r, 'name'),
        companyName: cell(r, 'companyName'),
        phone: fixPhone(cell(r, 'phone')),
        address: cell(r, 'address'),
        npwp: cell(r, 'npwp'),
        priceLevel: cell(r, 'priceLevel'),
        latitude,
        longitude,
        deliveryNotes: cell(r, 'deliveryNotes'),
      };
      parsed.push({ ...base, problems: validate(base, rawLat, rawLng, rawCoords) });
    });

    if (parsed.length === 0) {
      setFileError(t('customers.importPage.noRows'));
      return;
    }
    if (parsed.length > MAX_ROWS) {
      setFileError(t('customers.importPage.tooManyRows', { count: parsed.length, max: MAX_ROWS }));
      return;
    }
    setRows(parsed);
  }

  const problemCount = rows.filter((r) => r.problems.length > 0).length;
  const preview = useMemo(
    () => [...rows].sort((a, b) => Number(b.problems.length > 0) - Number(a.problems.length > 0)).slice(0, PREVIEW_LIMIT),
    [rows],
  );
  const showDeliveryCols = rows.some((r) => r.latitude != null || r.deliveryNotes);

  async function handleImport() {
    if (rows.length === 0 || problemCount > 0) return;
    setImportError(null);
    const payload = rows.map((r) => ({
      name: r.name,
      companyName: r.companyName || undefined,
      phone: r.phone || undefined,
      address: r.address || undefined,
      npwp: r.npwp || undefined,
      priceLevel: r.priceLevel || undefined,
      latitude: r.latitude ?? undefined,
      longitude: r.longitude ?? undefined,
      deliveryNotes: r.deliveryNotes || undefined,
    }));

    // Batches by size, remembering where each starts in `rows`.
    const batches: { start: number; items: typeof payload }[] = [];
    let current: typeof payload = [];
    let start = 0;
    let bytes = 0;
    payload.forEach((p, i) => {
      const size = JSON.stringify(p).length + 1;
      if (current.length > 0 && (bytes + size > BATCH_BYTES || current.length >= BATCH_MAX_ROWS)) {
        batches.push({ start, items: current });
        current = [];
        start = i;
        bytes = 0;
      }
      current.push(p);
      bytes += size;
    });
    if (current.length > 0) batches.push({ start, items: current });

    let created = 0;
    const skipped: Skipped[] = [];
    let done = 0;
    setProgress({ done, total: rows.length });
    try {
      for (const batch of batches) {
        const res = await apiFetch('/customers/import', {
          method: 'POST',
          body: JSON.stringify({ rows: batch.items }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const message = Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? `HTTP ${res.status}`);
          throw new Error(message);
        }
        created += body.created;
        for (const s of body.skipped as { row: number; name: string; reason: string }[]) {
          skipped.push({ excelRow: rows[batch.start + s.row].excelRow, name: s.name, reason: s.reason });
        }
        done += batch.items.length;
        setProgress({ done, total: rows.length });
      }
      setResult({ created, skipped });
      setRows([]);
      setFileName(null);
    } catch (err) {
      setImportError(t('customers.importPage.failed', { message: err instanceof Error ? err.message : String(err) }));
      if (created > 0) setResult({ created, skipped });
    } finally {
      setProgress(null);
    }
  }

  const fileInput = (
    <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
  );

  if (!authorized) return null; // useRequireAdmin redirects non-admins

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <Link href="/customers" className="text-xs font-medium text-blue-700 hover:underline">
            {t('customers.importPage.back')}
          </Link>
          <div className="flex items-center gap-2.5 min-w-0 mt-2">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <FileSpreadsheet size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('customers.importPage.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('customers.importPage.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        {result && (
          <div className="border border-green-200 bg-green-50 rounded-xl p-4 space-y-3">
            <p className="flex items-center gap-2 font-semibold text-green-800">
              <CheckCircle2 size={18} />
              {t('customers.importPage.doneTitle')} — {t('customers.importPage.created', { count: result.created })}
            </p>
            {result.skipped.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-amber-800">
                  {t('customers.importPage.skippedTitle', { count: result.skipped.length })}
                </p>
                <ul className="max-h-60 overflow-y-auto text-xs text-gray-700 bg-white border border-gray-200 rounded-md divide-y divide-gray-100">
                  {result.skipped.map((s) => (
                    <li key={s.excelRow} className="px-2.5 py-1.5 flex gap-2">
                      <span className="text-gray-400 shrink-0 w-14">
                        {t('customers.importPage.colRow')} {s.excelRow}
                      </span>
                      <span className="font-medium truncate">{s.name}</span>
                      <span className="text-gray-500 ml-auto text-right">
                        {t(`customers.importPage.reason.${s.reason}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Link
                href="/customers"
                className="text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700"
              >
                {t('customers.importPage.goToCustomers')}
              </Link>
              <label className="text-sm px-3 py-2 rounded-md border border-gray-300 bg-white font-medium cursor-pointer hover:bg-gray-50">
                {t('customers.importPage.importAnother')}
                {fileInput}
              </label>
            </div>
          </div>
        )}

        {importError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            {importError}
          </div>
        )}

        {!result && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="border border-blue-500/15 rounded-xl p-4 bg-white shadow-sm space-y-2">
              <h2 className="text-sm font-semibold">{t('customers.importPage.step1')}</h2>
              <p className="text-xs text-gray-500">{t('customers.importPage.step1Hint')}</p>
              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-blue-200 text-blue-700 bg-blue-50 font-medium hover:bg-blue-100"
              >
                <Download size={15} />
                {t('customers.importPage.downloadTemplate')}
              </button>
            </div>
            <div className="border border-blue-500/15 rounded-xl p-4 bg-white shadow-sm space-y-2">
              <h2 className="text-sm font-semibold">{t('customers.importPage.step2')}</h2>
              <p className="text-xs text-gray-500">{t('customers.importPage.step2Hint')}</p>
              <label className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold cursor-pointer hover:bg-blue-700">
                <Upload size={15} />
                {fileName ? t('customers.importPage.changeFile') : t('customers.importPage.chooseFile')}
                {fileInput}
              </label>
              {fileName && <p className="text-xs text-gray-600 truncate">{fileName}</p>}
            </div>
          </div>
        )}

        {fileError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            {fileError}
          </div>
        )}

        {rows.length > 0 && (
          <div className="border border-blue-500/15 rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="p-3 sm:p-4 flex flex-wrap items-center gap-3 border-b border-gray-100">
              <span className="text-sm font-semibold">{t('customers.importPage.summary', { total: rows.length })}</span>
              {problemCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                  <AlertTriangle size={12} />
                  {t('customers.importPage.problems', { count: problemCount })}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                  <CheckCircle2 size={12} />
                  {t('customers.importPage.allGood')}
                </span>
              )}
              <div className="flex flex-wrap gap-2 sm:ml-auto">
                {problemCount > 0 && (
                  <button
                    onClick={() => setRows((rs) => rs.filter((r) => r.problems.length === 0))}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-red-200 text-red-700 bg-white font-medium hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                    {t('customers.importPage.removeProblems')}
                  </button>
                )}
                <button
                  disabled={problemCount > 0 || progress !== null}
                  onClick={handleImport}
                  className="text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {progress
                    ? t('customers.importPage.importing', { done: progress.done, total: progress.total })
                    : t('customers.importPage.importButton', { count: rows.length })}
                </button>
              </div>
            </div>
            <p className="px-3 sm:px-4 py-2 text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
              {t('customers.importPage.dupeNote')}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('customers.importPage.colRow')}</th>
                    <th className="px-3 py-2 font-medium">{header('name')}</th>
                    <th className="px-3 py-2 font-medium">{header('phone')}</th>
                    <th className="px-3 py-2 font-medium">{header('address')}</th>
                    {showDeliveryCols && <th className="px-3 py-2 font-medium">{header('latitude')} / {header('longitude')}</th>}
                    <th className="px-3 py-2 font-medium">{t('customers.importPage.colProblem')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.map((r) => (
                    <tr key={r.excelRow} className={r.problems.length > 0 ? 'bg-red-50/60' : ''}>
                      <td className="px-3 py-2 text-gray-400">{r.excelRow}</td>
                      <td className="px-3 py-2 font-medium">
                        {r.name || <span className="text-red-600">—</span>}
                        {r.companyName && <div className="text-gray-500 font-normal">{r.companyName}</div>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.phone}</td>
                      <td className="px-3 py-2 max-w-[240px] truncate" title={r.address}>{r.address}</td>
                      {showDeliveryCols && (
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                          {r.latitude != null && r.longitude != null ? `${r.latitude}, ${r.longitude}` : ''}
                        </td>
                      )}
                      <td className="px-3 py-2 text-red-700">{r.problems.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > PREVIEW_LIMIT && (
              <p className="px-3 sm:px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
                {t('customers.importPage.showingFirst', { shown: PREVIEW_LIMIT, total: rows.length })}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
