'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Wrench } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatDMY } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, btnSecondary, inputCls } from '@/app/components/shared/PageFrame';
import type { Recommendation, WorkOrder } from './workOrders';

// Three months out, as yyyy-mm-dd for the date input.
function defaultDue() {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().slice(0, 10);
}

// Work spotted on this job for a later visit ("pads at 20%, replace next
// time"). Each is a reminder on the vehicle; a pending one can start the
// next job, which completes it.
export default function Recommendations({
  workOrderId,
  vehicleId,
  items,
  onChange,
}: {
  workOrderId: string;
  vehicleId: string;
  items: Recommendation[];
  onChange: (wo: WorkOrder) => void;
}) {
  const { t } = useLanguage();
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState(defaultDue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!note.trim() || !dueDate) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/work-orders/${workOrderId}/recommendations`, {
        method: 'POST',
        body: JSON.stringify({ note: note.trim(), dueDate }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? t('workshop.workOrders.saveFailed')));
        return;
      }
      onChange(body);
      setNote('');
      setDueDate(defaultDue());
    } catch {
      setError(t('workshop.workOrders.serverError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('workshop.workOrders.recommended')}>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">{t('workshop.workOrders.noRecommended')}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((r) => (
            <li key={r.id} className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm">{r.note}</p>
                <p className="text-xs text-gray-500">{t('workshop.workOrders.dueOn', { date: formatDMY(new Date(r.dueDate)) })}</p>
              </div>
              {r.status === 'PENDING' ? (
                <Link
                  href={`/workshop/work-orders/new?vehicleId=${vehicleId}&reminderId=${r.id}`}
                  className={`${btnSecondary} shrink-0`}
                >
                  <Wrench size={14} />
                  {t('workshop.workOrders.startJob')}
                </Link>
              ) : r.followUpWorkOrderId ? (
                <Link href={`/workshop/work-orders/${r.followUpWorkOrderId}`} className="text-xs text-green-700 underline shrink-0">
                  {t('workshop.workOrders.doneInJob')}
                </Link>
              ) : (
                <span className="text-xs text-green-700 shrink-0">{t('workshop.workOrders.recommendationDone')}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col sm:flex-row gap-2">
        <input
          className={`${inputCls} flex-1`}
          value={note}
          maxLength={300}
          placeholder={t('workshop.workOrders.recommendPlaceholder')}
          onChange={(e) => setNote(e.target.value)}
        />
        <input
          type="date"
          className={`${inputCls} sm:w-40`}
          value={dueDate}
          aria-label={t('workshop.workOrders.dueDate')}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <button type="button" className={btnSecondary} disabled={busy || !note.trim() || !dueDate} onClick={add}>
          <Plus size={14} />
          {t('workshop.workOrders.addRecommended')}
        </button>
      </div>
      <ErrorNote message={error} />
    </Card>
  );
}
