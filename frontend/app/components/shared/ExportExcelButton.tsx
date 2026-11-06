'use client';

import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { useDialog } from '@/app/components/shared/DialogProvider';
import { useLanguage } from '@/app/context/LanguageContext';
import { downloadExcel, type ExcelFile } from '@/lib/excel-export';

// `build` may fetch what the screen only holds a page of. The look follows
// the report's own filter buttons; pass className to place it in the row.
export function ExportExcelButton({
  build,
  disabled,
  className = '',
}: {
  build: () => ExcelFile | Promise<ExcelFile>;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await downloadExcel(await build());
    } catch {
      await dialog.alert(t('common.excel.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-md border-2 border-gray-300 text-gray-600 font-semibold hover:bg-blue-50 hover:border-blue-500/40 hover:text-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      <FileDown size={14} strokeWidth={2} />
      {busy ? t('common.excel.preparing') : t('common.excel.download')}
    </button>
  );
}
