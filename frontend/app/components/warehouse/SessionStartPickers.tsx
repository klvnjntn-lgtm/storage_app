'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Inbox, Undo2, UploadCloud, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { readErrorMessage } from '@/lib/api-error';
import { useLanguage } from '@/app/context/LanguageContext';

// Creates a session linked to a delivery (RECEIVE) or a sale (RETURNS) and
// opens it. Shared by both pickers below.
async function startLinkedSession(body: Record<string, string>): Promise<{ id?: string; error?: string }> {
  const res = await apiFetch('/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { error: await readErrorMessage(res) };
  const session = await res.json();
  return { id: session.id };
}

function PickerShell({
  icon,
  title,
  hint,
  onClose,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div className="mt-3 border border-blue-500/20 rounded-xl bg-white shadow-sm text-left overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
        <div className="flex items-start gap-2 min-w-0">
          <span className="shrink-0 mt-0.5">{icon}</span>
          <div className="min-w-0">
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-xs text-gray-500">{hint}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-blue-700 p-1 shrink-0" aria-label={t('common.cancel')}>
          <X size={16} strokeWidth={2.5} />
        </button>
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

type ImportBatchRow = {
  id: string;
  createdAt: string;
  lineCount: number;
  totalQty: number;
  receiveSessions: { id: string; status: string }[];
};

// Import-first receiving: arriving goods have no barcodes until an import
// has created them and labels are printed, so a receive check always
// counts against one import. Staff pick the delivery here; importing
// itself is admin-only, so only admins get the "import a delivery" link.
export function ReceiveBatchPicker({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const router = useRouter();
  const { t, language } = useLanguage();
  const dateLocale = language === 'id' ? 'id-ID' : 'en-US';
  const [batches, setBatches] = useState<ImportBatchRow[] | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/stock/import-batches?limit=10')
      .then(async (res) => (res.ok ? res.json() : Promise.reject(await readErrorMessage(res))))
      .then((rows: ImportBatchRow[]) => setBatches(rows))
      .catch((e) => {
        setBatches([]);
        setError(typeof e === 'string' ? e : t('inventory.warehousePage.loadImportsFailed'));
      });
  }, [t]);

  async function pick(batchId: string) {
    setStarting(batchId);
    setError('');
    const { id, error: err } = await startLinkedSession({ type: 'RECEIVE', importBatchId: batchId });
    setStarting(null);
    if (err) return setError(err);
    router.push(`/inventory/sessions/${id}`);
  }

  return (
    <PickerShell
      icon={<Inbox size={18} strokeWidth={2} className="text-emerald-700" />}
      title={t('inventory.warehousePage.receivePickerTitle')}
      hint={t('inventory.warehousePage.receivePickerHint')}
      onClose={onClose}
    >
      {batches === null && <p className="text-sm text-gray-500 p-1">{t('common.loading')}</p>}
      {batches?.length === 0 && !error && (
        <p className="text-sm text-gray-500 p-1">{t('inventory.warehousePage.noImports')}</p>
      )}
      {batches?.map((b) => {
        const checked = b.receiveSessions.length > 0;
        return (
          <button
            key={b.id}
            onClick={() => pick(b.id)}
            disabled={starting !== null}
            className="w-full flex items-center justify-between gap-3 border border-gray-200 hover:border-emerald-400 hover:bg-emerald-50/50 rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-60"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {new Date(b.createdAt).toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
              <p className="text-xs text-gray-500">
                {t('inventory.warehousePage.importSummary', { lines: b.lineCount, qty: b.totalQty })}
              </p>
            </div>
            {checked && (
              <span className="flex items-center gap-1 text-xs text-green-700 font-semibold shrink-0">
                <CheckCircle2 size={14} strokeWidth={2} />
                {t('inventory.warehousePage.alreadyChecked')}
              </span>
            )}
          </button>
        );
      })}
      {error && <p className="text-sm text-red-600 p-1">{error}</p>}
      {isAdmin && (
        <button
          onClick={() => router.push('/upload')}
          className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 hover:border-blue-400 hover:text-blue-700 rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-600 transition-colors"
        >
          <UploadCloud size={16} strokeWidth={2} />
          {t('inventory.warehousePage.importDelivery')}
        </button>
      )}
    </PickerShell>
  );
}

type InvoiceRow = {
  id: string;
  invoiceNumber: string | null;
  customerName: string | null;
  issuedAt: string | null;
};

// Returns are linked to the sale they reverse, so what can come back is
// capped by what actually went out.
export function ReturnInvoicePicker({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { t, language } = useLanguage();
  const dateLocale = language === 'id' ? 'id-ID' : 'en-US';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ status: 'ISSUED', page: '1', pageSize: '8' });
      if (query.trim()) params.set('search', query.trim());
      try {
        const res = await apiFetch(`/invoices?${params}`);
        if (stale) return;
        if (!res.ok) {
          setResults([]);
          setError(await readErrorMessage(res));
          return;
        }
        const body = await res.json();
        if (!stale) setResults(body.data ?? []);
      } catch {
        if (!stale) setResults([]);
      }
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function pick(invoiceId: string) {
    setStarting(invoiceId);
    setError('');
    const { id, error: err } = await startLinkedSession({ type: 'RETURNS', returnInvoiceId: invoiceId });
    setStarting(null);
    if (err) return setError(err);
    router.push(`/inventory/sessions/${id}`);
  }

  return (
    <PickerShell
      icon={<Undo2 size={18} strokeWidth={2} className="text-orange-600" />}
      title={t('inventory.warehousePage.returnPickerTitle')}
      hint={t('inventory.warehousePage.returnPickerHint')}
      onClose={onClose}
    >
      <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 px-3 py-2 focus-within:border-blue-500/50">
        <Search size={15} strokeWidth={2} className="text-blue-600/60 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('inventory.warehousePage.returnPickerSearch')}
          className="flex-1 min-w-0 text-sm outline-none bg-transparent"
        />
      </div>
      {results === null && <p className="text-sm text-gray-500 p-1">{t('common.loading')}</p>}
      {results?.length === 0 && !error && <p className="text-sm text-gray-500 p-1">{t('common.noResults')}</p>}
      {results?.map((inv) => (
        <button
          key={inv.id}
          onClick={() => pick(inv.id)}
          disabled={starting !== null}
          className="w-full flex items-center justify-between gap-3 border border-gray-200 hover:border-orange-400 hover:bg-orange-50/50 rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-60"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">#{inv.invoiceNumber ?? inv.id.slice(0, 8)}</p>
            <p className="text-xs text-gray-500 truncate">{inv.customerName ?? '—'}</p>
          </div>
          {inv.issuedAt && (
            <span className="text-xs text-gray-500 shrink-0">
              {new Date(inv.issuedAt).toLocaleDateString(dateLocale, { dateStyle: 'medium' })}
            </span>
          )}
        </button>
      ))}
      {error && <p className="text-sm text-red-600 p-1">{error}</p>}
    </PickerShell>
  );
}
