'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
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
};

const statusStyle = (status: string) => {
  switch (status?.toUpperCase()) {
    case 'OPEN':
    case 'IN_PROGRESS':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'COMPLETE':
    case 'COMPLETED':
    case 'DONE':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'CANCELLED':
      return 'bg-gray-100 text-gray-600 border-gray-300';
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
        className="min-h-screen text-black p-8"
        style={{
          backgroundColor: '#f8fafc',
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      >
        {t('inventory.sessionDetail.loading')}
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

      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-6 py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{session.type}</h1>
            {hasStages && session.stage && (
              <span className="text-xs px-2 py-1 rounded-md border font-medium bg-purple-100 text-purple-800 border-purple-300">
                {t('inventory.sessionDetail.stageLabel', { stage: session.stage })}
              </span>
            )}
            <span className={`text-xs px-2 py-1 rounded-md border font-medium ${statusStyle(session.status)}`}>
              {session.status}
            </span>
          </div>

          {/* Stage progress — works for any staged session type */}
          {hasStages && (
            <div className="flex items-center gap-2 mt-4">
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
                      {stage}
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
      </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto space-y-6">

        {/* Summary */}
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="border-2 border-gray-300 rounded-md p-4 flex items-start gap-3 bg-white">
            <Calendar size={18} strokeWidth={2} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500 font-semibold">{t('inventory.sessionDetail.created')}</p>
              <p className="font-medium">{new Date(session.createdAt).toLocaleString(dateLocale)}</p>
            </div>
          </div>

          <div className="border-2 border-gray-300 rounded-md p-4 flex items-start gap-3 bg-white">
            <Package size={18} strokeWidth={2} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500 font-semibold">{t('inventory.sessionDetail.products')}</p>
              <p className="font-bold text-lg">{(session.items ?? []).length}</p>
            </div>
          </div>

          <div className="border-2 border-gray-300 rounded-md p-4 flex items-start gap-3 bg-white">
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
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-semibold"
            >
              <ScanLine size={18} strokeWidth={2} />
              {hasStages ? t('inventory.sessionDetail.scanStage', { stage: session.stage ?? '' }) : t('inventory.sessionDetail.continueScanning')}
            </button>

            {hasStages && prevStage && (
              <button
                onClick={regressStage}
                disabled={regressing}
                className="flex items-center gap-2 border-2 border-gray-300 hover:bg-blue-50 disabled:opacity-50 text-gray-700 px-4 py-2 rounded-md font-semibold transition-colors"
                title={t('inventory.sessionDetail.goBackTo', { stage: prevStage })}
              >
                <ArrowLeftCircle size={18} strokeWidth={2} />
                {regressing ? t('inventory.sessionDetail.goingBack') : t('inventory.sessionDetail.backTo', { stage: prevStage })}
              </button>
            )}

            {hasStages && nextStage && (
              <button
                onClick={advanceStage}
                disabled={advancing}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-md font-semibold"
              >
                <ArrowRightCircle size={18} strokeWidth={2} />
                {advancing ? t('inventory.sessionDetail.advancing') : t('inventory.sessionDetail.nextStage', { stage: nextStage })}
              </button>
            )}

            <button
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md font-semibold"
              onClick={completeSession}
              disabled={!canComplete || completing}
              title={!canComplete ? t('inventory.sessionDetail.reachStageBeforeCompleting', { stage: stages[stages.length - 1] }) : undefined}
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
                className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md font-semibold"
              >
                <RotateCcw size={18} strokeWidth={2} />
                {t('inventory.sessionDetail.reopenSession')}
              </button>
            ) : (
              <div className="border-2 border-orange-300 rounded-md p-4 space-y-3 bg-orange-50">
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
                    className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-semibold"
                  >
                    {reopening ? t('inventory.sessionDetail.reopening') : t('inventory.sessionDetail.confirmReopen')}
                  </button>
                  <button
                    onClick={() => {
                      setReopenOpen(false);
                      setReopenReason('');
                    }}
                    className="border-2 border-gray-300 px-4 py-2 rounded-md text-sm font-semibold hover:bg-blue-50 transition-colors"
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
            <div className="border-2 border-gray-300 rounded-md divide-y divide-gray-200 bg-white">
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

          <div className="border-2 border-gray-300 rounded-md p-4 space-y-4 bg-white">
            {(session.notes ?? []).length > 0 && (
              <div className="space-y-3">
                {session.notes.map((n) => (
                  <div key={n.id} className="border-b border-gray-200 pb-3 last:border-b-0 last:pb-0">
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
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-semibold transition-colors"
            >
              {addingNote ? t('inventory.sessionDetail.adding') : t('inventory.sessionDetail.addNote')}
            </button>
          </div>
        </div>

        {/* Items */}
        <div>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">{t('inventory.sessionDetail.sessionItems')}</h2>

          <div className="border-2 border-gray-300 rounded-md overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-blue-50/60 border-b-2 border-gray-300">
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
                      className={`border-t border-gray-300 ${idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'}`}
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