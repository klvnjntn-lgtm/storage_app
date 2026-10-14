'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldCheck, Copy, Check } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, btnPrimary, btnDanger, btnSecondary, inputCls } from '@/app/components/shared/PageFrame';

type Status = { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; requiredByOrg: boolean };
type Setup = { secret: string; otpauthUrl: string; qrCode: string };

export default function SecurityPage() {
  return (
    <Suspense fallback={null}>
      <SecurityPageInner />
    </Suspense>
  );
}

function SecurityPageInner() {
  const { t } = useLanguage();
  const { user } = useCurrentUser();
  const search = useSearchParams();
  const isAdmin = user?.role === 'ADMIN';

  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disable, setDisable] = useState({ open: false, password: '', code: '' });
  const [policy, setPolicy] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch('/auth/2fa');
    if (res.ok) {
      const s: Status = await res.json();
      setStatus(s);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function call(path: string, body: object, method = 'POST') {
    setBusy(true);
    setError(null);
    const res = await apiFetch(path, { method, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(data?.message ?? t('security.failed'));
      return null;
    }
    return data;
  }

  async function startSetup() {
    const data = await call('/auth/2fa/setup', {});
    if (data) setSetup(data);
  }

  async function enable(e: React.FormEvent) {
    e.preventDefault();
    const data = await call('/auth/2fa/enable', { code: code.trim() });
    if (!data) return;
    setRecovery(data.recoveryCodes);
    setSetup(null);
    setCode('');
    load();
  }

  async function turnOff(e: React.FormEvent) {
    e.preventDefault();
    if (await call('/auth/2fa/disable', { password: disable.password, code: disable.code.trim() })) {
      setDisable({ open: false, password: '', code: '' });
      load();
    }
  }

  async function savePolicy(required: boolean) {
    const data = await call('/auth/2fa/policy', { require2faForAdmins: required }, 'PATCH');
    if (data) setPolicy(data.require2faForAdmins);
  }

  return (
    <PageFrame icon={ShieldCheck} title={t('security.title')} subtitle={t('security.subtitle')} width="max-w-2xl">
      {search.get('required') && !status?.enabled && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 text-sm rounded-md px-3 py-2">{t('security.requiredNotice')}</div>
      )}
      <ErrorNote message={error} />

      {recovery && (
        <Card title={t('security.recoveryTitle')}>
          <p className="text-sm text-gray-600 mb-3">{t('security.recoveryHint')}</p>
          <pre className="grid grid-cols-2 gap-1 font-mono text-sm bg-gray-50 border border-gray-200 rounded-md p-3">
            {recovery.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </pre>
          <button
            className={`${btnSecondary} mt-3`}
            onClick={async () => {
              await navigator.clipboard.writeText(recovery.join('\n'));
              setCopied(true);
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {t('security.copy')}
          </button>
        </Card>
      )}

      {status && (
        <Card title={t('security.twoFactorTitle')}>
          {status.enabled ? (
            <>
              <p className="text-sm">
                <span className="font-semibold text-green-700">{t('security.on')}</span> ·{' '}
                {t('security.recoveryLeft', { n: status.recoveryCodesLeft })}
              </p>
              {status.requiredByOrg ? (
                <p className="text-xs text-gray-500 mt-2">{t('security.requiredCantDisable')}</p>
              ) : disable.open ? (
                <form onSubmit={turnOff} className="mt-3 grid sm:grid-cols-2 gap-2">
                  <input type="password" required placeholder={t('security.password')} value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} className={inputCls} />
                  <input required inputMode="numeric" placeholder={t('security.codePlaceholder')} value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value })} className={inputCls} />
                  <div className="sm:col-span-2 flex gap-2">
                    <button type="button" className={btnSecondary} onClick={() => setDisable({ open: false, password: '', code: '' })}>
                      {t('common.cancel')}
                    </button>
                    <button className={btnDanger} disabled={busy}>
                      {t('security.turnOff')}
                    </button>
                  </div>
                </form>
              ) : (
                <button className={`${btnDanger} mt-3`} onClick={() => setDisable({ ...disable, open: true })}>
                  {t('security.turnOff')}
                </button>
              )}
            </>
          ) : setup ? (
            <form onSubmit={enable} className="space-y-3">
              <p className="text-sm text-gray-600">{t('security.scan')}</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from the backend */}
              <img src={setup.qrCode} alt={t('security.qrAlt')} width={220} height={220} className="border border-gray-200 rounded-md" />
              <p className="text-xs text-gray-500">
                {t('security.manualKey')} <code className="font-mono break-all">{setup.secret}</code>
              </p>
              <input
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${inputCls} max-w-40 text-center tracking-[0.3em]`}
              />
              <div>
                <button className={btnPrimary} disabled={busy}>
                  {t('security.confirmEnable')}
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-3">{t('security.explain')}</p>
              <button className={btnPrimary} disabled={busy} onClick={startSetup}>
                {t('security.turnOn')}
              </button>
            </>
          )}
        </Card>
      )}

      {isAdmin && status && (
        <Card title={t('security.policyTitle')}>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={policy ?? status.requiredByOrg}
              disabled={busy}
              onChange={(e) => savePolicy(e.target.checked)}
            />
            <span>
              {t('security.policyLabel')}
              <span className="block text-xs text-gray-500">{t('security.policyHint')}</span>
            </span>
          </label>
        </Card>
      )}
    </PageFrame>
  );
}
