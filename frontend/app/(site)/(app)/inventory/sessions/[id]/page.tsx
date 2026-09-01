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

const fmt = (d: string) =>
  new Date(d).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export default function SessionPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

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
      <main className="min-h-screen bg-white text-black p-8">
        Loading...
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
    <main className="min-h-screen bg-white text-black">

      {/* Header */}
      <div className="px-6 py-5 border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => router.push('/inventory/sessions')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to Sessions
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{session.type}</h1>
            {hasStages && session.stage && (
              <span className="text-xs px-2 py-1 rounded-md border font-medium bg-purple-100 text-purple-800 border-purple-300">
                Stage: {session.stage}
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
                          ? 'bg-black text-white border-black'
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
          <div className="border-2 border-gray-300 rounded-md p-4 flex items-start gap-3">
            <Calendar size={18} strokeWidth={2} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500 font-semibold">Created</p>
              <p className="font-medium">{new Date(session.createdAt).toLocaleString()}</p>
            </div>
          </div>

          <div className="border-2 border-gray-300 rounded-md p-4 flex items-start gap-3">
            <Package size={18} strokeWidth={2} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500 font-semibold">Products</p>
              <p className="font-bold text-lg">{(session.items ?? []).length}</p>
            </div>
          </div>

          <div className="border-2 border-gray-300 rounded-md p-4 flex items-start gap-3">
            <ListOrdered size={18} strokeWidth={2} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500 font-semibold">Total Qty</p>
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
              {hasStages ? `Scan (${session.stage})` : 'Continue Scanning'}
            </button>

            {hasStages && prevStage && (
              <button
                onClick={regressStage}
                disabled={regressing}
                className="flex items-center gap-2 border-2 border-gray-300 hover:bg-gray-100 disabled:opacity-50 text-gray-700 px-4 py-2 rounded-md font-semibold"
                title={`Go back to ${prevStage} — e.g. if you advanced before finishing`}
              >
                <ArrowLeftCircle size={18} strokeWidth={2} />
                {regressing ? 'Going back...' : `Back to ${prevStage}`}
              </button>
            )}

            {hasStages && nextStage && (
              <button
                onClick={advanceStage}
                disabled={advancing}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white px-4 py-2 rounded-md font-semibold"
              >
                <ArrowRightCircle size={18} strokeWidth={2} />
                {advancing ? 'Advancing...' : `Next: ${nextStage}`}
              </button>
            )}

            <button
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md font-semibold"
              onClick={completeSession}
              disabled={!canComplete || completing}
              title={!canComplete ? `Reach the ${stages[stages.length - 1]} stage before completing` : undefined}
            >
              <CheckCircle2 size={18} strokeWidth={2} />
              {completing ? 'Completing...' : 'Complete Session'}
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
                Reopen Session
              </button>
            ) : (
              <div className="border-2 border-orange-300 rounded-md p-4 space-y-3 bg-orange-50">
                <label className="text-sm font-semibold text-gray-700">
                  Why are you reopening this session?
                </label>
                <textarea
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  rows={2}
                  className="w-full border-2 border-gray-300 rounded-md p-3 text-sm focus:outline-none focus:border-orange-500 resize-y"
                  placeholder="e.g. Found 6 more units after completing, need to log them"
                />
                <div className="flex gap-3">
                  <button
                    onClick={submitReopen}
                    disabled={!reopenReason.trim() || reopening}
                    className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-semibold"
                  >
                    {reopening ? 'Reopening...' : 'Confirm Reopen'}
                  </button>
                  <button
                    onClick={() => {
                      setReopenOpen(false);
                      setReopenReason('');
                    }}
                    className="border-2 border-gray-300 px-4 py-2 rounded-md text-sm font-semibold hover:bg-gray-100"
                  >
                    Cancel
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
              Reopen History
            </h2>
            <div className="border-2 border-gray-300 rounded-md divide-y divide-gray-200">
              {session.reopenEvents.map((ev) => (
                <div key={ev.id} className="p-3 text-sm flex items-start justify-between gap-4">
                  <p className="flex-1">{ev.reason}</p>
                  <p className="text-gray-500 whitespace-nowrap text-xs">
                    {fmt(ev.createdAt)}{ev.user?.email ? ` · ${ev.user.email}` : ''}
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
            Notes
          </h2>

          <div className="border-2 border-gray-300 rounded-md p-4 space-y-4">
            {(session.notes ?? []).length > 0 && (
              <div className="space-y-3">
                {session.notes.map((n) => (
                  <div key={n.id} className="border-b border-gray-200 pb-3 last:border-b-0 last:pb-0">
                    <p className="text-sm">{n.note}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {fmt(n.createdAt)}{n.user?.email ? ` · ${n.user.email}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="e.g. Supplier manifest listed 120 units, only 114 scanned in — 6 short on SKU ABC-123."
              rows={3}
              className="w-full border-2 border-gray-300 rounded-md p-3 text-sm focus:outline-none focus:border-blue-500 resize-y"
            />

            <button
              onClick={submitNote}
              disabled={!noteDraft.trim() || addingNote}
              className="bg-black hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-semibold"
            >
              {addingNote ? 'Adding...' : 'Add Note'}
            </button>
          </div>
        </div>

        {/* Items */}
        <div>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Session Items</h2>

          <div className="border-2 border-gray-300 rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b-2 border-gray-300">
                <tr>
                  <th className="p-3 text-left font-semibold">Product</th>
                  <th className="p-3 text-left font-semibold">SKU</th>
                  <th className="p-3 text-left font-semibold">Qty</th>
                  <th className="p-3 text-left font-semibold">From</th>
                  <th className="p-3 text-left font-semibold">To</th>
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
                      No items in this session
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