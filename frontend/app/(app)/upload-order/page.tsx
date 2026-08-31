'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  UploadCloud,
  AlertCircle,
  CheckCircle2,
  PlugZap,
  Database,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

// ─────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────

type ImportMode = 'csv' | 'gdb';

type Connection = {
  id: string;
  provider: string;
  columnMapping: Record<string, string> | null;
  createdAt: string;
};

type StandardField = 'externalRef' | 'sku' | 'quantity' | 'customerName';

const STANDARD_FIELDS: { key: StandardField; label: string; required: boolean }[] = [
  { key: 'externalRef', label: 'Invoice / Order Number', required: true },
  { key: 'sku', label: 'SKU', required: true },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'customerName', label: 'Customer Name', required: false },
];

type CsvPreviewResponse = {
  headers: string[];
  preview: Record<string, string>[];
  totalRows: number;
  savedMapping: Record<string, string> | null;
  rawRows: Record<string, string>[];
};

type CsvImportResult = {
  created: number;
  skipped: number;
  errors: string[];
};

type GdbPreviewResponse = {
  token: string;
  itemCount: number;
  invoiceCount: number;
  customerCount: number;
};

type GdbImportTarget = 'products_only' | 'full_invoices';

type GdbImportResult = {
  items: { created: number; updated: number };
  invoices?: {
    created: number;
    skipped: number;
    errors: string[];
    fractionalQuantityWarnings: string[];
    discountIgnoredWarnings: string[];
  };
};

// ─────────────────────────────────────────────────────────────
// Raw upload/post helpers — bypass apiFetch's forced JSON
// content-type since multipart uploads need the browser to set
// its own boundary header.
// ─────────────────────────────────────────────────────────────

async function uploadFile(path: string, file: File): Promise<Response> {
  const token = localStorage.getItem('accessToken');
  const formData = new FormData();
  formData.append('file', file);

  // Goes through Next's rewrite proxy (see next.config.ts), same as
  // apiFetch — no need to hit the backend directly. Don't set
  // Content-Type here: the browser needs to set its own multipart
  // boundary, which it can only do if we let it set the header itself.
  return fetch(`/api${path}`, {
    method: 'POST',
    headers: { Authorization: token ? `Bearer ${token}` : '' },
    body: formData,
  });
}
async function postJson(path: string, body: unknown): Promise<Response> {
  const token = localStorage.getItem('accessToken');

  return fetch(`/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify(body),
  });
}

export default function ImportOrdersPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<ImportMode>('csv');

  // ── CSV state ──────────────────────────────────────────────
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<string>('');
  const [newProviderName, setNewProviderName] = useState('');
  const [creatingConnection, setCreatingConnection] = useState(false);
  const [connectionsLoading, setConnectionsLoading] = useState(true);

  const [csvPreview, setCsvPreview] = useState<CsvPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<StandardField, string>>({
    externalRef: '',
    sku: '',
    quantity: '',
    customerName: '',
  });
  const [csvResult, setCsvResult] = useState<CsvImportResult | null>(null);

  // ── GDB state ───────────────────────────────────────────────
  const [gdbPreview, setGdbPreview] = useState<GdbPreviewResponse | null>(null);
  const [gdbTarget, setGdbTarget] = useState<GdbImportTarget>('products_only');
  const [gdbResult, setGdbResult] = useState<GdbImportResult | null>(null);

  // ── shared state ────────────────────────────────────────────
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  useEffect(() => {
    loadConnections();
  }, []);

  async function loadConnections() {
    setConnectionsLoading(true);
    try {
      const res = await apiFetch('/integrations/connections');
      const data = await res.json();
      setConnections(data);
      if (data.length > 0) setConnectionId(data[0].id);
    } catch (err) {
      console.error(err);
    } finally {
      setConnectionsLoading(false);
    }
  }

  async function handleCreateConnection() {
    if (!newProviderName.trim()) return;
    setCreatingConnection(true);
    try {
      const res = await apiFetch('/integrations/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: newProviderName.trim() }),
      });
      const created = await res.json();
      setConnections((prev) => [...prev, created]);
      setConnectionId(created.id);
      setNewProviderName('');
    } catch (err) {
      console.error(err);
    } finally {
      setCreatingConnection(false);
    }
  }

  function resetImportState() {
    setCsvPreview(null);
    setCsvResult(null);
    setGdbPreview(null);
    setGdbResult(null);
    setConfirmError('');
    setUploadError('');
    setMapping({ externalRef: '', sku: '', quantity: '', customerName: '' });
  }

  function handleModeChange(next: ImportMode) {
    setMode(next);
    resetImportState();
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── CSV upload ──────────────────────────────────────────────

  async function handleCsvFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !connectionId) return;

    resetImportState();
    setFileName(file.name);
    setUploading(true);

    try {
      const res = await uploadFile(
        `/integrations/import/preview?connectionId=${connectionId}`,
        file,
      );
      const data: CsvPreviewResponse = await res.json();

      if (!res.ok) {
        setUploadError((data as any)?.message || 'Could not read that file');
        return;
      }

      setCsvPreview(data);

      const initialMapping: Record<StandardField, string> = {
        externalRef: '',
        sku: '',
        quantity: '',
        customerName: '',
      };

      for (const field of STANDARD_FIELDS) {
        const saved = data.savedMapping?.[field.key];
        if (saved && data.headers.includes(saved)) {
          initialMapping[field.key] = saved;
        } else {
          const guess = data.headers.find(
            (h) => h.toLowerCase() === field.key.toLowerCase(),
          );
          if (guess) initialMapping[field.key] = guess;
        }
      }

      setMapping(initialMapping);
    } catch (err) {
      console.error(err);
      setUploadError('Could not reach the server — check the console for details.');
    } finally {
      setUploading(false);
    }
  }

  const mappingComplete = STANDARD_FIELDS.filter((f) => f.required).every(
    (f) => mapping[f.key],
  );

  async function handleCsvConfirm() {
    if (!csvPreview || !connectionId || !mappingComplete) return;

    setConfirming(true);
    setConfirmError('');
    setCsvResult(null);

    try {
      const rows = csvPreview.rawRows.map((row) => ({
        externalRef: row[mapping.externalRef] ?? '',
        sku: row[mapping.sku] ?? '',
        quantity: Number(row[mapping.quantity]) || 0,
        customerName: mapping.customerName ? row[mapping.customerName] : undefined,
      }));

      const res = await apiFetch('/integrations/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, columnMapping: mapping, rows }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setConfirmError(data?.message || `Import failed (status ${res.status})`);
        return;
      }

      setCsvResult(data);
      setCsvPreview(null);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error(err);
      setConfirmError('Could not reach the server — check the console for details.');
    } finally {
      setConfirming(false);
    }
  }

  // ── GDB upload ──────────────────────────────────────────────

  async function handleGdbFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    resetImportState();
    setFileName(file.name);
    setUploading(true);

    try {
      const res = await uploadFile('/integrations/accurate-gdb/upload', file);
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setUploadError(data?.message || 'Could not read that file');
        return;
      }

      setGdbPreview(data);
    } catch (err) {
      console.error(err);
      setUploadError('Could not reach the server — check the console for details.');
    } finally {
      setUploading(false);
    }
  }

  async function handleGdbConfirm() {
    if (!gdbPreview) return;

    setConfirming(true);
    setConfirmError('');
    setGdbResult(null);

    try {
      const res = await postJson(`/integrations/accurate-gdb/confirm/${gdbPreview.token}`, {
        target: gdbTarget,
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setConfirmError(data?.message || `Import failed (status ${res.status})`);
        return;
      }

      setGdbResult(data);
      setGdbPreview(null);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error(err);
      setConfirmError('Could not reach the server — check the console for details.');
    } finally {
      setConfirming(false);
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
            <PlugZap size={22} strokeWidth={2} className="text-gray-700" />
            <div>
              <h1 className="text-2xl font-bold">Order Import</h1>
              <p className="text-xs text-gray-500">
                Import invoices/orders from a CSV file or an Accurate Desktop .GDB database
              </p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => handleModeChange('csv')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold border-2 ${
                mode === 'csv'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
              }`}
            >
              <UploadCloud size={16} strokeWidth={2} />
              CSV file
            </button>
            <button
              onClick={() => handleModeChange('gdb')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold border-2 ${
                mode === 'gdb'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
              }`}
            >
              <Database size={16} strokeWidth={2} />
              Accurate GDB
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-5xl mx-auto space-y-6">

        {/* ═══════════════════════ CSV RESULT ═══════════════════════ */}
        {mode === 'csv' && csvResult && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
              <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
              <span>
                Import complete — {csvResult.created} order{csvResult.created === 1 ? '' : 's'} created,{' '}
                {csvResult.skipped} skipped (already imported).
              </span>
            </div>

            {csvResult.errors.length > 0 && (
              <div className="border-2 border-red-300 rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-red-50 border-b-2 border-red-300 text-red-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle size={14} strokeWidth={2} />
                  {csvResult.errors.length} row{csvResult.errors.length === 1 ? '' : 's'} skipped
                </div>
                <ul className="text-sm divide-y divide-gray-200">
                  {csvResult.errors.map((e, i) => (
                    <li key={i} className="px-3 py-2 text-red-700">{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════ CSV FLOW ═══════════════════════ */}
        {mode === 'csv' && (
          <>
            <section className="border-2 border-gray-300 rounded-md p-5 space-y-3">
              <label className="block text-xs font-semibold text-gray-600">
                Connection — which system is this file from?
              </label>

              {connectionsLoading ? (
                <p className="text-sm text-gray-500">Loading connections...</p>
              ) : (
                <div className="flex flex-col sm:flex-row gap-3">
                  <select
                    value={connectionId}
                    onChange={(e) => {
                      setConnectionId(e.target.value);
                      resetImportState();
                      setFileName('');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="flex-1 border-2 border-gray-300 rounded-md px-3 py-2 text-sm font-medium"
                  >
                    {connections.length === 0 && <option value="">No connections yet</option>}
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.provider}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-gray-100">
                <input
                  value={newProviderName}
                  onChange={(e) => setNewProviderName(e.target.value)}
                  placeholder="e.g. accurate_desktop_csv"
                  className="flex-1 border-2 border-gray-300 rounded-md px-3 py-2 text-sm"
                />
                <button
                  onClick={handleCreateConnection}
                  disabled={!newProviderName.trim() || creatingConnection}
                  className="px-4 py-2 border-2 border-gray-300 rounded-md text-sm font-semibold hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {creatingConnection ? 'Adding...' : 'New connection'}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Each connection remembers its own column mapping, so returning imports from the same
                source won't need remapping.
              </p>
            </section>

            <section className="border-2 border-gray-300 rounded-md p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Invoice / order file
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  disabled={!connectionId || uploading}
                  onChange={handleCsvFileUpload}
                  className="text-sm file:mr-3 file:px-3 file:py-2 file:rounded-md file:border-2 file:border-gray-300 file:bg-white file:font-semibold file:cursor-pointer hover:file:bg-gray-100 disabled:opacity-40"
                />
              </div>

              {!connectionId && !connectionsLoading && (
                <p className="text-xs text-gray-500">Select or create a connection above first.</p>
              )}

              {uploading && <p className="text-sm text-gray-500">Reading file...</p>}

              {uploadError && (
                <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
                  <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                  {uploadError}
                </div>
              )}
            </section>

            {csvPreview && (
              <section className="space-y-4">
                <div className="border-2 border-gray-300 rounded-md p-5 space-y-3">
                  <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                    Match columns
                  </h2>
                  <p className="text-xs text-gray-500">
                    {fileName} — {csvPreview.totalRows} row{csvPreview.totalRows === 1 ? '' : 's'} found.
                    Match each field below to a column from your file.
                  </p>

                  <div className="grid sm:grid-cols-2 gap-3 pt-2">
                    {STANDARD_FIELDS.map((field) => (
                      <div key={field.key}>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">
                          {field.label}
                          {field.required && <span className="text-red-600"> *</span>}
                        </label>
                        <select
                          value={mapping[field.key]}
                          onChange={(e) =>
                            setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          className="w-full border-2 border-gray-300 rounded-md px-3 py-2 text-sm"
                        >
                          <option value="">— not mapped —</option>
                          {csvPreview.headers.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  {!mappingComplete && (
                    <div className="flex items-start gap-2 bg-yellow-50 border-2 border-yellow-300 text-yellow-800 rounded-md p-3 text-sm">
                      <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                      Invoice/Order Number, SKU, and Quantity are required before importing.
                    </div>
                  )}
                </div>

                <div className="border-2 border-gray-300 rounded-md overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 border-b-2 border-gray-300">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold">Invoice #</th>
                        <th className="text-left px-3 py-2 font-semibold">SKU</th>
                        <th className="text-left px-3 py-2 font-semibold">Qty</th>
                        <th className="text-left px-3 py-2 font-semibold">Customer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreview.preview.map((row, i) => (
                        <tr
                          key={i}
                          className={`border-t border-gray-300 ${i % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
                        >
                          <td className="px-3 py-2 font-medium">
                            {mapping.externalRef ? row[mapping.externalRef] : '—'}
                          </td>
                          <td className="px-3 py-2">{mapping.sku ? row[mapping.sku] : '—'}</td>
                          <td className="px-3 py-2">{mapping.quantity ? row[mapping.quantity] : '—'}</td>
                          <td className="px-3 py-2 text-gray-600">
                            {mapping.customerName ? row[mapping.customerName] : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-500 px-3 py-2 bg-gray-50 border-t border-gray-300">
                    Showing first {csvPreview.preview.length} of {csvPreview.totalRows} rows
                  </p>
                </div>

                {confirmError && (
                  <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
                    <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                    {confirmError}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={handleCsvConfirm}
                    disabled={!mappingComplete || confirming}
                    className="flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-md font-semibold hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <UploadCloud size={18} strokeWidth={2} />
                    {confirming ? 'Importing...' : `Import ${csvPreview.totalRows} Row${csvPreview.totalRows === 1 ? '' : 's'}`}
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {/* ═══════════════════════ GDB RESULT ═══════════════════════ */}
        {mode === 'gdb' && gdbResult && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-green-50 border-2 border-green-300 text-green-800 rounded-md p-3 text-sm">
              <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
              <span>
                Import complete — {gdbResult.items.created} product{gdbResult.items.created === 1 ? '' : 's'} created,{' '}
                {gdbResult.items.updated} updated
                {gdbResult.invoices &&
                  `, ${gdbResult.invoices.created} invoice${gdbResult.invoices.created === 1 ? '' : 's'} created, ${gdbResult.invoices.skipped} skipped (already imported)`}
                .
              </span>
            </div>

            {gdbResult.invoices && gdbResult.invoices.fractionalQuantityWarnings.length > 0 && (
              <div className="border-2 border-yellow-300 rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-yellow-50 border-b-2 border-yellow-300 text-yellow-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle size={14} strokeWidth={2} />
                  {gdbResult.invoices.fractionalQuantityWarnings.length} quantity rounded — review
                </div>
                <ul className="text-sm divide-y divide-gray-200 max-h-48 overflow-y-auto">
                  {gdbResult.invoices.fractionalQuantityWarnings.map((w, i) => (
                    <li key={i} className="px-3 py-2 text-yellow-800">{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {gdbResult.invoices && gdbResult.invoices.discountIgnoredWarnings.length > 0 && (
              <div className="border-2 border-yellow-300 rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-yellow-50 border-b-2 border-yellow-300 text-yellow-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle size={14} strokeWidth={2} />
                  {gdbResult.invoices.discountIgnoredWarnings.length} line discount(s) not applied — review
                </div>
                <ul className="text-sm divide-y divide-gray-200 max-h-48 overflow-y-auto">
                  {gdbResult.invoices.discountIgnoredWarnings.map((w, i) => (
                    <li key={i} className="px-3 py-2 text-yellow-800">{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {gdbResult.invoices && gdbResult.invoices.errors.length > 0 && (
              <div className="border-2 border-red-300 rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-red-50 border-b-2 border-red-300 text-red-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle size={14} strokeWidth={2} />
                  {gdbResult.invoices.errors.length} invoice{gdbResult.invoices.errors.length === 1 ? '' : 's'} failed
                </div>
                <ul className="text-sm divide-y divide-gray-200">
                  {gdbResult.invoices.errors.map((e, i) => (
                    <li key={i} className="px-3 py-2 text-red-700">{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════ GDB FLOW ═══════════════════════ */}
        {mode === 'gdb' && !gdbPreview && !gdbResult && (
          <section className="border-2 border-gray-300 rounded-md p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Accurate .GDB file
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".gdb"
                disabled={uploading}
                onChange={handleGdbFileUpload}
                className="text-sm file:mr-3 file:px-3 file:py-2 file:rounded-md file:border-2 file:border-gray-300 file:bg-white file:font-semibold file:cursor-pointer hover:file:bg-gray-100 disabled:opacity-40"
              />
            </div>

            {uploading && <p className="text-sm text-gray-500">Reading database file…</p>}

            {uploadError && (
              <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
                <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                {uploadError}
              </div>
            )}
          </section>
        )}

        {mode === 'gdb' && gdbPreview && (
          <section className="border-2 border-gray-300 rounded-md p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
              Confirm import
            </h2>
            <p className="text-xs text-gray-500">
              {fileName} — found <strong>{gdbPreview.itemCount}</strong> items,{' '}
              <strong>{gdbPreview.customerCount}</strong> customers, and{' '}
              <strong>{gdbPreview.invoiceCount}</strong> invoices.
            </p>

            <fieldset className="space-y-2 pt-2 border-t border-gray-100">
              <legend className="text-xs font-semibold text-gray-600 mb-1">
                What does this customer need?
              </legend>

              <label className="flex items-start gap-2 border-2 border-gray-300 rounded-md p-3 cursor-pointer has-[:checked]:border-black">
                <input
                  type="radio"
                  className="mt-1"
                  checked={gdbTarget === 'products_only'}
                  onChange={() => setGdbTarget('products_only')}
                />
                <span>
                  <span className="block text-sm font-semibold">Products only</span>
                  <span className="block text-xs text-gray-500">
                    Warehouse/fulfillment customers — imports items as products, nothing else.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 border-2 border-gray-300 rounded-md p-3 cursor-pointer has-[:checked]:border-black">
                <input
                  type="radio"
                  className="mt-1"
                  checked={gdbTarget === 'full_invoices'}
                  onChange={() => setGdbTarget('full_invoices')}
                />
                <span>
                  <span className="block text-sm font-semibold">Products + Customers + Invoices</span>
                  <span className="block text-xs text-gray-500">
                    Invoicing/POS customers — also imports historical invoices and customer records.
                  </span>
                </span>
              </label>
            </fieldset>

            {confirmError && (
              <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm">
                <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                {confirmError}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleGdbConfirm}
                disabled={confirming}
                className="flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-md font-semibold hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <UploadCloud size={18} strokeWidth={2} />
                {confirming ? 'Importing…' : 'Confirm import'}
              </button>
            </div>
          </section>
        )}

      </div>
    </main>
  );
}