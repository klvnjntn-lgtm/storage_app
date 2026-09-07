'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Space_Grotesk } from 'next/font/google';
import {
  ArrowLeft,
  UploadCloud,
  AlertCircle,
  CheckCircle2,
  PlugZap,
  Database,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] });

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
  // NEW — null when this GDB has no PO module data at all (preview() wraps
  // that lookup in a try/catch and falls back to null rather than failing
  // the whole preview).
  purchaseOrderCount: number | null;
  vendorCount: number | null;
};

// NEW — was 'products_only' | 'full_invoices'. Matches the controller's
// GdbImportTarget exactly; keep these in sync if a target is ever added.
type GdbImportTarget = 'products_only' | 'full_invoices' | 'full_invoices_and_purchase_orders';

type GdbImportResult = {
  items: { created: number; updated: number };
  invoices?: {
    created: number;
    skipped: number;
    errors: string[];
    fractionalQuantityWarnings: string[];
    discountIgnoredWarnings: string[];
  };
  // NEW
  purchaseOrders?: {
    created: number;
    updated: number;
    errors: string[];
    missingSupplierWarnings: string[];
    duplicatePoNumberWarnings: string[];
    closedButNotFullyReceivedWarnings: string[];
    overReceivedWarnings: string[];
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
          <button
            onClick={() => router.push('/home')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-700 mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-blue-50 rounded-md transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Scanner Hub
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <PlugZap size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                Order Import
              </h1>
              <p className="text-xs text-gray-500 truncate">
                Import invoices/orders from a CSV file or an Accurate Desktop .GDB database
              </p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => handleModeChange('csv')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                mode === 'csv'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-gray-600 border-blue-500/20 hover:bg-blue-50 hover:border-blue-500/35'
              }`}
            >
              <UploadCloud size={16} strokeWidth={2} />
              CSV file
            </button>
            <button
              onClick={() => handleModeChange('gdb')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                mode === 'gdb'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-gray-600 border-blue-500/20 hover:bg-blue-50 hover:border-blue-500/35'
              }`}
            >
              <Database size={16} strokeWidth={2} />
              Accurate GDB
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 sm:space-y-6">

        {/* ═══════════════════════ CSV RESULT ═══════════════════════ */}
        {mode === 'csv' && csvResult && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl p-3 text-sm">
              <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
              <span>
                Import complete — {csvResult.created} order{csvResult.created === 1 ? '' : 's'} created,{' '}
                {csvResult.skipped} skipped (already imported).
              </span>
            </div>

            {csvResult.errors.length > 0 && (
              <div className="border border-red-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-red-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
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
            <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
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
                    className="flex-1 border border-blue-500/20 rounded-lg px-3 py-2 text-sm font-medium outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all"
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

              <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-blue-500/10">
                <input
                  value={newProviderName}
                  onChange={(e) => setNewProviderName(e.target.value)}
                  placeholder="e.g. accurate_desktop_csv"
                  className="flex-1 border border-blue-500/20 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all"
                />
                <button
                  onClick={handleCreateConnection}
                  disabled={!newProviderName.trim() || creatingConnection}
                  className="px-4 py-2 border border-blue-500/20 rounded-lg text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {creatingConnection ? 'Adding...' : 'New connection'}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Each connection remembers its own column mapping, so returning imports from the same
                source won't need remapping.
              </p>
            </section>

            <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-4">
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
                  className="text-sm file:mr-3 file:px-3 file:py-2 file:rounded-md file:border file:border-blue-500/20 file:bg-white file:font-semibold file:cursor-pointer hover:file:bg-blue-50 disabled:opacity-40"
                />
              </div>

              {!connectionId && !connectionsLoading && (
                <p className="text-xs text-gray-500">Select or create a connection above first.</p>
              )}

              {uploading && <p className="text-sm text-gray-500">Reading file...</p>}

              {uploadError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
                  <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                  {uploadError}
                </div>
              )}
            </section>

            {csvPreview && (
              <section className="space-y-4">
                <div className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
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
                          className="w-full border border-blue-500/20 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500/50 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.08)] transition-all"
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
                    <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-xl p-3 text-sm">
                      <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                      Invoice/Order Number, SKU, and Quantity are required before importing.
                    </div>
                  )}
                </div>

                <div className="border border-blue-500/15 rounded-xl overflow-hidden overflow-x-auto bg-white shadow-sm">
                  <table className="w-full text-sm">
                    <thead className="bg-blue-50/60 border-b border-blue-500/15">
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
                          className={`border-t border-blue-500/10 ${i % 2 === 1 ? 'bg-blue-50/20' : 'bg-white'}`}
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
                  <p className="text-xs text-gray-500 px-3 py-2 bg-blue-50/40 border-t border-blue-500/10">
                    Showing first {csvPreview.preview.length} of {csvPreview.totalRows} rows
                  </p>
                </div>

                {confirmError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
                    <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                    {confirmError}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={handleCsvConfirm}
                    disabled={!mappingComplete || confirming}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl p-3 text-sm">
              <CheckCircle2 size={18} strokeWidth={2} className="shrink-0" />
              <span>
                Import complete — {gdbResult.items.created} product{gdbResult.items.created === 1 ? '' : 's'} created,{' '}
                {gdbResult.items.updated} updated
                {gdbResult.invoices &&
                  `, ${gdbResult.invoices.created} invoice${gdbResult.invoices.created === 1 ? '' : 's'} created, ${gdbResult.invoices.skipped} skipped (already imported)`}
                {gdbResult.purchaseOrders &&
                  `, ${gdbResult.purchaseOrders.created} purchase order${gdbResult.purchaseOrders.created === 1 ? '' : 's'} created, ${gdbResult.purchaseOrders.updated} updated`}
                .
              </span>
            </div>

            {gdbResult.invoices && gdbResult.invoices.fractionalQuantityWarnings.length > 0 && (
              <div className="border border-yellow-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
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
              <div className="border border-yellow-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
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
              <div className="border border-red-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-red-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
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

            {/* NEW — Purchase Order import warnings/errors, same pattern as invoices above */}
            {gdbResult.purchaseOrders && gdbResult.purchaseOrders.missingSupplierWarnings.length > 0 && (
              <div className="border border-yellow-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle size={14} strokeWidth={2} />
                  {gdbResult.purchaseOrders.missingSupplierWarnings.length} PO{gdbResult.purchaseOrders.missingSupplierWarnings.length === 1 ? '' : 's'} with unmatched vendor — review
                </div>
                <ul className="text-sm divide-y divide-gray-200 max-h-48 overflow-y-auto">
                  {gdbResult.purchaseOrders.missingSupplierWarnings.map((w, i) => (
                    <li key={i} className="px-3 py-2 text-yellow-800">{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {gdbResult.purchaseOrders && gdbResult.purchaseOrders.duplicatePoNumberWarnings.length > 0 && (
              <div className="border border-yellow-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle size={14} strokeWidth={2} />
                  {gdbResult.purchaseOrders.duplicatePoNumberWarnings.length} duplicate PO number{gdbResult.purchaseOrders.duplicatePoNumberWarnings.length === 1 ? '' : 's'} — renumbered
                </div>
                <ul className="text-sm divide-y divide-gray-200 max-h-48 overflow-y-auto">
                  {gdbResult.purchaseOrders.duplicatePoNumberWarnings.map((w, i) => (
                    <li key={i} className="px-3 py-2 text-yellow-800">{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {gdbResult.purchaseOrders && gdbResult.purchaseOrders.closedButNotFullyReceivedWarnings.length > 0 && (
              <div className="border border-yellow-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle size={14} strokeWidth={2} />
                  {gdbResult.purchaseOrders.closedButNotFullyReceivedWarnings.length} closed PO{gdbResult.purchaseOrders.closedButNotFullyReceivedWarnings.length === 1 ? '' : 's'} with partial receiving — review
                </div>
                <ul className="text-sm divide-y divide-gray-200 max-h-48 overflow-y-auto">
                  {gdbResult.purchaseOrders.closedButNotFullyReceivedWarnings.map((w, i) => (
                    <li key={i} className="px-3 py-2 text-yellow-800">{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {gdbResult.purchaseOrders && gdbResult.purchaseOrders.overReceivedWarnings.length > 0 && (
              <div className="border border-yellow-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle size={14} strokeWidth={2} />
                  {gdbResult.purchaseOrders.overReceivedWarnings.length} line{gdbResult.purchaseOrders.overReceivedWarnings.length === 1 ? '' : 's'} received more than ordered — review
                </div>
                <ul className="text-sm divide-y divide-gray-200 max-h-48 overflow-y-auto">
                  {gdbResult.purchaseOrders.overReceivedWarnings.map((w, i) => (
                    <li key={i} className="px-3 py-2 text-yellow-800">{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {gdbResult.purchaseOrders && gdbResult.purchaseOrders.errors.length > 0 && (
              <div className="border border-red-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-red-800 text-xs font-semibold uppercase tracking-wide flex items-center gap-2">
                  <AlertCircle size={14} strokeWidth={2} />
                  {gdbResult.purchaseOrders.errors.length} purchase order{gdbResult.purchaseOrders.errors.length === 1 ? '' : 's'} failed
                </div>
                <ul className="text-sm divide-y divide-gray-200">
                  {gdbResult.purchaseOrders.errors.map((e, i) => (
                    <li key={i} className="px-3 py-2 text-red-700">{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════ GDB FLOW ═══════════════════════ */}
        {mode === 'gdb' && !gdbPreview && !gdbResult && (
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-4">
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
                className="text-sm file:mr-3 file:px-3 file:py-2 file:rounded-md file:border file:border-blue-500/20 file:bg-white file:font-semibold file:cursor-pointer hover:file:bg-blue-50 disabled:opacity-40"
              />
            </div>

            {uploading && <p className="text-sm text-gray-500">Reading database file…</p>}

            {uploadError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
                <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                {uploadError}
              </div>
            )}
          </section>
        )}

        {mode === 'gdb' && gdbPreview && (
          <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
              Confirm import
            </h2>
            <p className="text-xs text-gray-500">
              {fileName} — found <strong>{gdbPreview.itemCount}</strong> items,{' '}
              <strong>{gdbPreview.customerCount}</strong> customers,{' '}
              <strong>{gdbPreview.invoiceCount}</strong> invoices
              {gdbPreview.purchaseOrderCount != null && (
                <>
                  , and <strong>{gdbPreview.purchaseOrderCount}</strong> purchase orders
                  {gdbPreview.vendorCount != null && (
                    <> from <strong>{gdbPreview.vendorCount}</strong> vendors</>
                  )}
                </>
              )}
              .
            </p>

            <fieldset className="space-y-2 pt-2 border-t border-blue-500/10">
              <legend className="text-xs font-semibold text-gray-600 mb-1">
                What does this customer need?
              </legend>

              <label className="flex items-start gap-2 border border-blue-500/15 rounded-xl p-3 cursor-pointer has-[:checked]:border-blue-500/50 has-[:checked]:bg-blue-50/60 transition-colors">
                <input
                  type="radio"
                  className="mt-1 accent-blue-600"
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

              <label className="flex items-start gap-2 border border-blue-500/15 rounded-xl p-3 cursor-pointer has-[:checked]:border-blue-500/50 has-[:checked]:bg-blue-50/60 transition-colors">
                <input
                  type="radio"
                  className="mt-1 accent-blue-600"
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

              {/* NEW — third target, only worth offering when this GDB actually
                  has PO data; a file with no PO module would just show 0/0
                  every time otherwise. */}
              <label
                className={`flex items-start gap-2 border border-blue-500/15 rounded-xl p-3 has-[:checked]:border-blue-500/50 has-[:checked]:bg-blue-50/60 transition-colors ${
                  gdbPreview.purchaseOrderCount ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'
                }`}
              >
                <input
                  type="radio"
                  className="mt-1 accent-blue-600"
                  disabled={!gdbPreview.purchaseOrderCount}
                  checked={gdbTarget === 'full_invoices_and_purchase_orders'}
                  onChange={() => setGdbTarget('full_invoices_and_purchase_orders')}
                />
                <span>
                  <span className="block text-sm font-semibold">
                    Products + Customers + Invoices + Purchase Orders
                  </span>
                  <span className="block text-xs text-gray-500">
                    Also imports vendors and historical purchase orders, including receiving history.
                    {!gdbPreview.purchaseOrderCount && ' No purchase order data found in this file.'}
                  </span>
                </span>
              </label>
            </fieldset>

            {confirmError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
                <AlertCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5" />
                {confirmError}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleGdbConfirm}
                disabled={confirming}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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