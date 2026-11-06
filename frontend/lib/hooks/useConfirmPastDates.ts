'use client';

import { useCallback } from 'react';
import { useDialog } from '@/app/components/shared/DialogProvider';
import { useLanguage } from '@/app/context/LanguageContext';
import { formatDMY, isPastDate, parseCalendarDate } from '@/lib/dates';

export type PastDateField =
  | 'document'
  | 'payment'
  | 'journal'
  | 'disposal'
  | 'due'
  | 'expected'
  | 'validUntil'
  | 'reminder'
  | 'expiry'
  | 'route'
  | 'reschedule';

// Asks before saving a date that has already passed: usually a slip of the
// calendar, sometimes a deliberate catch-up, and only the user can tell which.
// Resolves true when there's nothing to ask or they chose to go on:
//   if (!(await confirmPastDates({ document: date, due: dueDate }))) return;
// Fields that are normally in the past (a supplier's own bill date, when a
// fixed asset was bought) don't belong here.
export function useConfirmPastDates() {
  const dialog = useDialog();
  const { t } = useLanguage();
  return useCallback(
    async (fields: Partial<Record<PastDateField, string | null | undefined>>) => {
      const past = (Object.entries(fields) as [PastDateField, string][]).filter(([, value]) => isPastDate(value));
      if (past.length === 0) return true;
      const list = past
        .map(([field, value]) => `${t(`common.pastDate.fields.${field}`)}: ${formatDMY(parseCalendarDate(value))}`)
        .join(', ');
      return dialog.confirm(t('common.pastDate.confirm', { list }));
    },
    [dialog, t],
  );
}
