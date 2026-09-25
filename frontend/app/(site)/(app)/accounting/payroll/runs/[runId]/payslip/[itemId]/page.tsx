'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Printer, ArrowLeft } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { PayslipA4Template } from '@/app/components/payroll/templates/PayslipA4Template';
import { PayslipPrintView } from '@/app/components/payroll/types';
import { useLanguage } from '@/app/context/LanguageContext';


export default function PayslipPrintPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const params = useParams<{ runId: string; itemId: string }>();
  const { itemId } = params;

  const [payslip, setPayslip] = useState<PayslipPrintView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/payroll/items/${itemId}/print-view`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.message ?? t('accounting.payroll.requestFailed', { status: res.status }));
          return;
        }
        setPayslip(await res.json());
      } catch {
        setError(t('accounting.payroll.couldNotReachServer'));
      } finally {
        setLoading(false);
      }
    })();
  }, [itemId, t]);

  function handlePrint() {
    window.print();
  }

  return (
    <main className="min-h-screen print:min-h-0 bg-gray-50 text-black">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>

      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)] print:hidden">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push('/accounting/payroll')}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors shrink-0"
            >
              <ArrowLeft size={14} strokeWidth={2} />
              {t('common.back')}
            </button>
            <h1 className={`${display.className} text-lg sm:text-xl font-bold tracking-tight truncate`}>
              {t('accounting.payroll.payslipTemplate.title')}
            </h1>
          </div>

          {payslip && (
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors shrink-0"
            >
              <Printer size={14} strokeWidth={2} />
              {t('common.print')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 print:hidden">
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
        </div>
      )}

      <div className="py-8 px-4 overflow-x-auto print:p-0 print:overflow-visible">
        <div className="mx-auto w-fit">
          {payslip ? (
            <div
              id="print-area"
              className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)] print:shadow-none"
            >
              <PayslipA4Template payslip={payslip} />
            </div>
          ) : (
            <div
              className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_8px_24px_rgba(0,0,0,0.12)] flex items-center justify-center text-sm text-gray-400"
              style={{ width: '210mm', height: '297mm' }}
            >
              {loading ? t('common.loading') : error ? t('accounting.payroll.payslipTemplate.loadError') : null}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
