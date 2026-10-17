'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FlaskConical, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, btnPrimary, btnSecondary } from '@/app/components/shared/PageFrame';

type Payment = {
  externalId: string;
  purpose: 'SUBSCRIPTION' | 'WA_TOPUP';
  status: string;
  amount: string;
  gateway: string;
};

// Stand-in for the payment provider's checkout page, used only by the fake
// gateway (no XENDIT_SECRET_KEY outside production). The backend refuses
// to complete any payment that didn't come from the fake gateway.
export default function FakeCheckoutPage() {
  const { authorized } = useRequireAdmin();
  const { t } = useLanguage();
  const router = useRouter();
  const { externalId } = useParams<{ externalId: string }>();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authorized) return;
    (async () => {
      const res = await apiFetch(`/billing/payments/${encodeURIComponent(externalId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.message ?? t('billing.loadFailed'));
      else setPayment(body);
    })();
  }, [authorized, externalId, t]);

  const returnPath = payment?.purpose === 'WA_TOPUP' ? '/settings/whatsapp' : '/settings/billing';

  async function pay() {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/billing/payments/${encodeURIComponent(externalId)}/fake-pay`, { method: 'POST' });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(body?.message ?? t('billing.checkoutFailed'));
      return;
    }
    router.push(`${returnPath}?payment=${encodeURIComponent(externalId)}`);
  }

  return (
    <PageFrame icon={FlaskConical} title={t('billing.fakeCheckoutTitle')} subtitle={t('billing.fakeCheckoutSubtitle')}>
      <ErrorNote message={error} />
      {payment && (
        <Card>
          <p className="text-sm text-gray-600">{t('billing.fakeCheckoutAmount')}</p>
          <p className="text-3xl font-bold tabular-nums">{formatIDR(Number(payment.amount))}</p>
          <p className="mt-1 text-xs text-gray-500">{payment.externalId}</p>
          <div className="mt-4 flex gap-2">
            <button className={btnPrimary} onClick={pay} disabled={busy || payment.status !== 'PENDING'}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t('billing.fakeCheckoutPay')}
            </button>
            <a className={btnSecondary} href={`${returnPath}?payment=${encodeURIComponent(externalId)}&failed=1`}>
              {t('common.cancel')}
            </a>
          </div>
        </Card>
      )}
    </PageFrame>
  );
}
