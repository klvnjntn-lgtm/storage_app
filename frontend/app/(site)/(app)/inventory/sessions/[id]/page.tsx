'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ClipboardList,
  Calendar,
  Package,
  ListOrdered,
  ScanLine,
  CheckCircle2,
  StickyNote,
  RotateCcw,
  History,
  ArrowRightCircle,
  ArrowLeftCircle,
  Receipt,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

type SessionItem = {
  id: number;
  quantity: number;
  product: {
    id: string;
    name: string;
    sku: string;
  };
  events: {
    fromLocation: { name: string } | null;
    toLocation: { name: string } | null;
  }[];
};

type SessionNoteEntry = {
  id: string;
  note: string;
  createdAt: string;
  user?: { id: string; email: string } | null;
};

type ReopenEvent = {
  id: string;
  reason: string;
  createdAt: string;
  userId?: string | null;
  user?: { id: string; email: string } | null;
};

type SessionInvoice = {
  id: string;
  invoiceNumber: string | null;
  salesOrderId: string | null;
  salesOrder: { id: string; orderNumber: string | null } | null;
};

type Session = {
  id: string;
  type: string;
  stage: string | null;      // current stage, e.g. "PICK" — null for non-staged sessions
  stages: string[] | null;   // full ordered stage list for this session, from backend — null if not staged
  status: string;
  createdAt: string;
  completedAt: string | null;
  items: SessionItem[];
  notes: SessionNoteEntry[];
  reopenEvents: ReopenEvent[];
  invoice: SessionInvoice | null;
};

const statusStyle = (status: string) => {
  switch (status?.toUpperCase()) {
    case 'OPEN':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'COMPLETED':
      return 'bg-green-100 text-green-800 border-green-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
};

const fmt = (d: string, locale: string) =>
  new Date(d).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export default function SessionPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { t, language } = useLanguage();
  const dateLocale = language === 'id' ? 'id-ID' : 'en-US';

  const typeLabel = (type: string) => t(`inventory.sessionTypeLabels.${type}`) || type;
  const statusLabel = (status: string) => t(`inventory.sessionStatusLabels.${status}`) || status;
  const stageLabel = (stage: string) => t(`inventory.sessionStageLabels.${stage}`) || stage;

  const [session, setSession] = useState<Session | null>(null);

  const [noteDraft, setNoteDraft] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopening, setReopening] = useState(false);

  const [advancing, setAdvancing] = useState(false);
  const [regressing, setRegressing] = useState(false);
  const [completing, setCompleting] = useState(false);

  const loadSession = async () => {
    const res = await apiFetch(`/sessions/${id}`);
    const data = await res.json();
    if (!res.ok) return;
    setSession(data);
  };

  useEffect(() => {
    if (!id) return;
    loadSession();
  }, [id]);

  const submitNote = async () => {
    if (!session || !noteDraft.trim()) return;
    setAddingNote(true);
    try {
      const res = await apiFetch(`/sessions/${session.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteDraft.trim() }),
      });
      if (res.ok) {
        setNoteDraft('');
        loadSession();
      }
    } finally {
      setAddingNote(false);
    }
  };

  const submitReopen = async () => {
    if (!session || !reopenReason.trim()) return;
    setReopening(true);
    try {
      const res = await apiFetch(`/sessions/${session.id}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reopenReason.trim() }),
      });
      if (res.ok) {
        setReopenReason('');
        setReopenOpen(false);
        loadSession();
      }
    } finally {
      setReopening(false);
    }
  };

  const advanceStage = async () => {
    if (!session) return;
    setAdvancing(true);
    try {
      const res = await apiFetch(`/sessions/${session.id}/advance`, {
        method: 'POST',
      });
      if (res.ok) {
        loadSession();
      }
    } finally {
      setAdvancing(false);
    }
  };

  const regressStage = async () => {
    if (!session) return;
    setRegressing(true);
    try {
      const res = await apiFetch(`/sessions/${session.id}/back`, {
        method: 'POST',
      });
      if (res.ok) {
        loadSession();
      }
    } finally {
      setRegressing(false);
    }
  };

  const completeSession = async () => {
    if (!session) return;
    setCompleting(true);
    try {
      const res = await apiFetch(`/sessions/${session.id}/complete`, {
        method: 'POST',
      });
      if (res.ok) {
        loadSession();
      }
    } finally {
      setCompleting(false);
    }
  };

  if (!session) {
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
        {/* Skeleton — mirrors the eventual header + summary-card layout so
            the page doesn't jump/reflow once data arrives. */}
        <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15">
          <div className="max-w-5xl mx-auto flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-lg bg-gray-100 animate-pulse shrink-0" />
            <div className="space-y-1.5">
              <span className="block h-5 w-40 rounded bg-gray-100 animate-pulse" />
              <span className="block h-3 w-24 rounded bg-gray-100 animate-pulse" />
            </div>
          </div>
        </div>
        <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <span key={i} className="block h-16 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
          <span className="block h-40 rounded-xl bg-gray-100 animate-pulse" />
        </div>
      </main>
    );
  }

  const totalItems = (session.items ?? []).reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  // Driven entirely by what the backend returns — works for FULFILLMENT
  // (2 or 3 stages depending on org setting) and MOVE (always PICK, MOVE)
  // without any hardcoded stage list here.
  const hasStages = !!session.stages && session.stages.length > 0;
  const stages = session.stages ?? [];
  const stageIndex = hasStages ? stages.indexOf(session.stage ?? '') : -1;
  const nextStage = hasStages ? stages[stageIndex + 1] : null;
  const prevStage = hasStages ? stages[stageIndex - 1] : null;
  const canComplete = !hasStages || session.stage === stages[stages.length - 1];

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
      {/* Header — icon badge + title/subtitle, matching /inventory/stock/[id]
          and /inventory/sessions. */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <ClipboardList size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight truncate">{typeLabel(session.type)}</h1>
              <p className="text-xs text-gray-500 truncate">
                {t('inventory.sessionDetail.sessionIdLabel', { id: session.id.slice(0, 8) })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {hasStages && session.stage && (
              <span className="text-xs px-2.5 py-1.5 rounded-md border font-medium bg-purple-100 text-purple-800 border-purple-300">
                {t('inventory.sessionDetail.stageLabel', { stage: stageLabel(session.stage) })}
              </span>
            )}
            <span className={`text-xs px-2.5 py-1.5 rounded-md border font-medium ${statusStyle(session.status)}`}>
              {statusLabel(session.status)}
            </span>
          </div>
        </div>

        {/* Stage progress — works for any staged session type */}
        {hasStages && (
          <div className="max-w-5xl mx-auto flex items-center gap-2 mt-4">
            {stages.map((stage, i) => {
              const reached = i <= stageIndex;
              return (
                <div key={stage} className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${
                      reached
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-400 border-gray-300'
                    }`}
                  >
                    {stageLabel(stage)}
                  </span>
                  {i < stages.length - 1 && (
                    <span className="text-gray-300">→</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">

        {/* Source document — only present for a FULFILLMENT session created
            from an invoice (requires INVOICE_POS to have an invoice at
            all, plus WAREHOUSE_OPS to route it through a session instead
            of direct issue). */}
        {session.invoice && (
          <div className="border border-purple-300/60 rounded-xl p-4 bg-purple-50/50 flex items-start gap-3">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-purple-600/10 border border-purple-600/20 shrink-0">
              <Receipt size={18} strokeWidth={2} className="text-purple-700" />
            </span>
            <div className="min-w-0">
              <button
                onClick={() => router.push(`/sales/invoices/${session.invoice!.id}`)}
                className="font-semibold text-purple-900 hover:underline"
              >
                {t('inventory.sessionDetail.fulfillingInvoice', {
                  number: session.invoice.invoiceNumber ?? session.invoice.id.slice(0, 8),
                })}
              </button>
              {session.invoice.salesOrder && (
                <p className="mt-0.5">
                  <button
                    onClick={() => router.push(`/sales/orders/${session.invoice!.salesOrder!.id}`)}
                    className="text-sm text-purple-700/80 hover:underline"
                  >
                    {t('inventory.sessionDetail.fromSalesOrder', {
                      number: session.invoice.salesOrder.orderNumber ?? session.invoice.salesOrder.id.slice(0, 8),
                    })}
                  </button>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="border border-blue-500/15 rounded-xl p-4 flex items-start gap-3 bg-white shadow-sm">
            <Calendar size={18} strokeWidth={2} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500 font-semibold">{t('inventory.sessionDetail.created')}</p>
              <p className="font-medium">{new Date(session.createdAt).toLocaleString(dateLocale)}</p>
            </div>
          </div>

          <div className="border border-blue-500/15 rounded-xl p-4 flex items-start gap-3 bg-white shadow-sm">
            <Package size={18} strokeWidth={2} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500 font-semibold">{t('inventory.sessionDetail.products')}</p>
              <p className="font-bold text-lg">{(session.items ?? []).length}</p>
            </div>
          </div>

          <div className="border border-blue-500/15 rounded-xl p-4 flex items-start gap-3 bg-white shadow-sm">
            <ListOrdered size={18} strokeWidth={2} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500 font-semibold">{t('inventory.sessionDetail.totalQty')}</p>
              <p className="font-bold text-lg">{totalItems}</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        {session.status === 'OPEN' && (
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => router.push(`/scan?sessionId=${session.id}`)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold shadow-sm transition-colors"
            >
              <ScanLine size={18} strokeWidth={2} />
              {hasStages ? t('inventory.sessionDetail.scanStage', { stage: stageLabel(session.stage ?? '') }) : t('inventory.sessionDetail.continueScanning')}
            </button>

            {hasStages && prevStage && (
              <button
                onClick={regressStage}
                disabled={regressing}
                className="flex items-center gap-2 border border-gray-300 hover:bg-blue-50 disabled:opacity-50 text-gray-700 px-4 py-2 rounded-lg font-semibold transition-colors"
                title={t('inventory.sessionDetail.goBackTo', { stage: stageLabel(prevStage) })}
              >
                <ArrowLeftCircle size={18} strokeWidth={2} />
                {regressing ? t('inventory.sessionDetail.goingBack') : t('inventory.sessionDetail.backTo', { stage: stageLabel(prevStage) })}
              </button>
            )}

            {hasStages && nextStage && (
              <button
                onClick={advanceStage}
                disabled={advancing}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg font-semibold shadow-sm transition-colors"
              >
                <ArrowRightCircle size={18} strokeWidth={2} />
                {advancing ? t('inventory.sessionDetail.advancing') : t('inventory.sessionDetail.nextStage', { stage: stageLabel(nextStage) })}
              </button>
            )}

            <button
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold shadow-sm transition-colors"
              onClick={completeSession}
              disabled={!canComplete || completing}
              title={!canComplete ? t('inventory.sessionDetail.reachStageBeforeCompleting', { stage: stageLabel(stages[stages.length - 1]) }) : undefined}
            >
              <CheckCircle2 size={18} strokeWidth={2} />
              {completing ? t('inventory.sessionDetail.completing') : t('inventory.sessionDetail.completeSession')}
            </button>
          </div>
        )}

        {session.status === 'COMPLETED' && (
          <div>
            {!reopenOpen ? (
              <button
                onClick={() => setReopenOpen(true)}
                className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg font-semibold shadow-sm transition-colors"
              >
                <RotateCcw size={18} strokeWidth={2} />
                {t('inventory.sessionDetail.reopenSession')}
              </button>
            ) : (
              <div className="border border-orange-300 rounded-xl p-4 space-y-3 bg-orange-50">
                <label className="text-sm font-semibold text-gray-700">
                  {t('inventory.sessionDetail.reopenPrompt')}
                </label>
                <textarea
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  rows={2}
                  className="w-full border-2 border-gray-300 rounded-md p-3 text-sm focus:outline-none focus:border-orange-500 resize-y"
                  placeholder={t('inventory.sessionDetail.reopenPlaceholder')}
                />
                <div className="flex gap-3">
                  <button
                    onClick={submitReopen}
                    disabled={!reopenReason.trim() || reopening}
                    className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                  >
                    {reopening ? t('inventory.sessionDetail.reopening') : t('inventory.sessionDetail.confirmReopen')}
                  </button>
                  <button
                    onClick={() => {
                      setReopenOpen(false);
                      setReopenReason('');
                    }}
                    className="border border-gray-300 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-50 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reopen history */}
        {(session.reopenEvents ?? []).length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3 flex items-center gap-2">
              <History size={16} strokeWidth={2} />
              {t('inventory.sessionDetail.reopenHistory')}
            </h2>
            <div className="border border-blue-500/15 rounded-xl divide-y divide-gray-100 bg-white shadow-sm overflow-hidden">
              {session.reopenEvents.map((ev) => (
                <div key={ev.id} className="p-3 text-sm flex items-start justify-between gap-4">
                  <p className="flex-1">{ev.reason}</p>
                  <p className="text-gray-500 whitespace-nowrap text-xs">
                    {fmt(ev.createdAt, dateLocale)}{ev.user?.email ? ` · ${ev.user.email}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3 flex items-center gap-2">
            <StickyNote size={16} strokeWidth={2} />
            {t('inventory.sessionDetail.notes')}
          </h2>

          <div className="border border-blue-500/15 rounded-xl p-4 space-y-4 bg-white shadow-sm">
            {(session.notes ?? []).length > 0 && (
              <div className="space-y-3">
                {session.notes.map((n) => (
                  <div key={n.id} className="border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
                    <p className="text-sm">{n.note}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {fmt(n.createdAt, dateLocale)}{n.user?.email ? ` · ${n.user.email}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={t('inventory.sessionDetail.notePlaceholder')}
              rows={3}
              className="w-full border-2 border-gray-300 rounded-md p-3 text-sm focus:outline-none focus:border-blue-500 resize-y"
            />

            <button
              onClick={submitNote}
              disabled={!noteDraft.trim() || addingNote}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              {addingNote ? t('inventory.sessionDetail.adding') : t('inventory.sessionDetail.addNote')}
            </button>
          </div>
        </div>

        {/* Items */}
        <div>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">{t('inventory.sessionDetail.sessionItems')}</h2>

          <div className="border border-blue-500/15 rounded-xl overflow-hidden bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-blue-50/60 border-b border-blue-500/15">
                <tr>
                  <th className="p-3 text-left font-semibold">{t('inventory.sessionDetail.colProduct')}</th>
                  <th className="p-3 text-left font-semibold">{t('inventory.sessionDetail.colSku')}</th>
                  <th className="p-3 text-left font-semibold">{t('inventory.sessionDetail.colQty')}</th>
                  <th className="p-3 text-left font-semibold">{t('inventory.sessionDetail.colFrom')}</th>
                  <th className="p-3 text-left font-semibold">{t('inventory.sessionDetail.colTo')}</th>
                </tr>
              </thead>

              <tbody>
                {(session.items ?? []).map((item, idx) => {
                  const event = item.events[0];
                  return (
                    <tr
                      key={item.id}
                      className={`border-t border-gray-100 ${idx % 2 === 1 ? 'bg-gray-50/60' : 'bg-white'}`}
                    >
                      <td className="p-3 font-medium">{item.product.name}</td>
                      <td className="p-3 text-gray-500">{item.product.sku}</td>
                      <td className="p-3 font-bold">{item.quantity}</td>
                      <td className="p-3 text-gray-500">{event?.fromLocation?.name ?? '—'}</td>
                      <td className="p-3 text-gray-500">{event?.toLocation?.name ?? '—'}</td>
                    </tr>
                  );
                })}

                {(session.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-gray-500">
                      {t('inventory.sessionDetail.noItems')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </main>
  );
}
