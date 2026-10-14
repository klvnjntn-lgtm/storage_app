'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';
import { toCalendarDateString } from '@/lib/dates';

// A workshop service reminder typed while making an invoice. It's only
// "staged" until the invoice is issued — submit() saves it then — so an
// abandoned invoice never leaves a reminder behind. Picking a different
// vehicle starts over.
export function useStagedReminder(vehicleId: string | null) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [staged, setStaged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setOpen(false);
    setNote('');
    setDueDate('');
    setStaged(false);
    setSaved(false);
    setError('');
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reset();
  }, [vehicleId, reset]);

  function pickPreset(months: number) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    setDueDate(toCalendarDateString(d));
    setSaved(false);
  }

  function stage() {
    if (!vehicleId || !note.trim() || !dueDate) return;
    setStaged(true);
    setError('');
  }

  // Called once the invoice is issued.
  async function submit() {
    if (!vehicleId || !staged || !note.trim() || !dueDate) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`/vehicles/${vehicleId}/reminders`, {
        method: 'POST',
        body: JSON.stringify({ note: note.trim(), dueDate: new Date(dueDate).toISOString() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || `Failed to save reminder (${res.status})`);
      }
      setSaved(true);
    } catch (e: unknown) {
      console.error('Reminder submit failed', e);
    } finally {
      setSaving(false);
    }
  }

  return {
    open,
    toggleOpen: () => setOpen((v) => !v),
    note,
    setNote,
    dueDate,
    setDueDate,
    staged,
    saving,
    saved,
    error,
    pickPreset,
    stage,
    submit,
    reset,
  };
}
