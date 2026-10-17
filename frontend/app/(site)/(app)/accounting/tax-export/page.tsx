'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { formatDMY } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';
import { PageFrame, Card, ErrorNote, btnPrimary, inputCls, thCls, tdCls } from '@/app/components/shared/PageFrame';

type Row = {
  id: string;
  invoiceNumber: string | null;
  date: string;
  customerName: string | null;
  taxBase: number;
  vat: number;
  exportedAt: string | null;
};
type Preview = {
  sellerTinValid: boolean;
  ready: Row[];
  skipped: (Row & { reason: 'NO_BUYER_TIN' | 'UNSUPPORTED_RATE' | 'UNTAXED_LINES' })[];
};

// PPN is filed per month (masa pajak), so the period is a month.
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

function lastMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function TaxExportPage() {
  const { t } = useLanguage();
  const [month, setMonth] = useState(lastMonth);
  const [includeExported, setIncludeExported] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  // State is only set after the request returns, so this is safe to run
  // from the effect below; callers that want a spinner set loading first.
  const load = useCallback(async () => {
    if (!month) return;
    try {
      const { from, to } = monthRange(month);
      const res = await apiFetch(`/tax-export/coretax/preview?from=${from}&to=${to}&includeExported=${includeExported}`);
      const body = await res.json().catch(() => null);
      setError(null);
      if (!res.ok) {
        setError(body?.message ?? t('accounting.taxExport.loadFailed'));
        setPreview(null);
        return;
      }
      setPreview(body);
    } catch {
      setError(t('accounting.taxExport.serverError'));
    } finally {
      setLoading(false);
    }
  }, [month, includeExported, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function download() {
    setDownloading(true);
    setError(null);
    setDone(null);
    try {
      const { from, to } = monthRange(month);
      const res = await apiFetch('/tax-export/coretax', {
        method: 'POST',
        body: JSON.stringify({ from, to, includeExported }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('accounting.taxExport.exportFailed'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `faktur-keluaran-${month}.xml`;
      a.click();
      URL.revokeObjectURL(url);
      setDone(Number(res.headers.get('X-Faktur-Count') ?? preview?.ready.length ?? 0));
      await load();
    } catch {
      setError(t('accounting.taxExport.serverError'));
    } finally {
      setDownloading(false);
    }
  }

  const totalVat = preview?.ready.reduce((s, r) => s + r.vat, 0) ?? 0;

  return (
    <PageFrame icon={FileDown} title={t('accounting.taxExport.title')} subtitle={t('accounting.taxExport.subtitle')}>
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">{t('accounting.taxExport.period')}</span>
            <input type="month" className={`${inputCls} mt-1`} value={month} onChange={(e) => {
                setLoading(true);
                setMonth(e.target.value);
              }} />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 sm:pb-2">
            <input type="checkbox" checked={includeExported} onChange={(e) => {
              setLoading(true);
              setIncludeExported(e.target.checked);
            }} />
            {t('accounting.taxExport.includeExported')}
          </label>
          <div className="sm:ml-auto">
            <button
              type="button"
              className={btnPrimary}
              disabled={downloading || loading || !preview?.sellerTinValid || !preview?.ready.length}
              onClick={download}
            >
              <FileDown size={14} />
              {downloading ? t('accounting.taxExport.downloading') : t('accounting.taxExport.download', { count: preview?.ready.length ?? 0 })}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">{t('accounting.taxExport.howTo')}</p>
      </Card>

      {preview && !preview.sellerTinValid && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-md px-3 py-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {t('accounting.taxExport.noSellerTin')}{' '}
            <Link href="/settings" className="underline font-medium">
              {t('accounting.taxExport.openSettings')}
            </Link>
          </span>
        </div>
      )}
      {done != null && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 text-sm rounded-md px-3 py-2">
          <CheckCircle2 size={16} />
          {t('accounting.taxExport.done', { count: done })}
        </div>
      )}
      <ErrorNote message={error} />

      <Card title={t('accounting.taxExport.readyTitle', { count: preview?.ready.length ?? 0 })}>
        {loading && <p className="text-sm text-gray-500">{t('accounting.taxExport.loading')}</p>}
        {!loading && preview?.ready.length === 0 && <p className="text-sm text-gray-400">{t('accounting.taxExport.noneReady')}</p>}
        {!!preview?.ready.length && (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className={thCls}>{t('accounting.taxExport.invoice')}</th>
                  <th className={thCls}>{t('accounting.taxExport.date')}</th>
                  <th className={thCls}>{t('accounting.taxExport.customer')}</th>
                  <th className={`${thCls} text-right`}>{t('accounting.taxExport.taxBase')}</th>
                  <th className={`${thCls} text-right`}>{t('accounting.taxExport.vat')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.ready.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className={tdCls}>
                      <Link href={`/sales/invoices/${r.id}`} className="text-blue-700 hover:underline">
                        {r.invoiceNumber}
                      </Link>
                      {r.exportedAt && (
                        <span className="ml-2 text-xs text-gray-400">{t('accounting.taxExport.exported')}</span>
                      )}
                    </td>
                    <td className={tdCls}>{formatDMY(new Date(r.date))}</td>
                    <td className={tdCls}>{r.customerName}</td>
                    <td className={`${tdCls} text-right`}>{formatIDR(r.taxBase)}</td>
                    <td className={`${tdCls} text-right`}>{formatIDR(r.vat)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={`${tdCls} font-semibold`} colSpan={4}>
                    {t('accounting.taxExport.totalVat')}
                  </td>
                  <td className={`${tdCls} text-right font-semibold`}>{formatIDR(totalVat)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {!!preview?.skipped.length && (
        <Card title={t('accounting.taxExport.skippedTitle', { count: preview.skipped.length })}>
          <p className="text-xs text-gray-500 mb-3">{t('accounting.taxExport.skippedHint')}</p>
          <ul className="divide-y divide-gray-100">
            {preview.skipped.map((r) => (
              <li key={r.id} className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span className="text-sm">
                  <Link href={`/sales/invoices/${r.id}`} className="text-blue-700 hover:underline">
                    {r.invoiceNumber}
                  </Link>{' '}
                  <span className="text-gray-500">· {r.customerName}</span>
                </span>
                <span className="text-xs text-amber-700">{t(`accounting.taxExport.reason.${r.reason}`)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageFrame>
  );
}
