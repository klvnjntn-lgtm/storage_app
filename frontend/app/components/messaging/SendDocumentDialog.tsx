'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, MessageCircle, Send, X, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';

type Channel = 'EMAIL' | 'WHATSAPP';

// Email or WhatsApp a document (invoice, purchase order, statement).
// `endpoint` is the backend send route; `extraBody` carries anything else
// it needs (the statement's customer and period). WhatsApp is charged
// against the org's prepaid balance, so its errors point to the top-up page.
export function SendDocumentDialog({
  title,
  endpoint,
  defaultEmail,
  defaultPhone,
  extraBody,
  onClose,
}: {
  title: string;
  endpoint: string;
  defaultEmail?: string | null;
  defaultPhone?: string | null;
  extraBody?: Record<string, unknown>;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [channel, setChannel] = useState<Channel>('EMAIL');
  // WhatsApp stays a "coming soon" tab until the server switches it on.
  const [whatsappOn, setWhatsappOn] = useState(false);
  useEffect(() => {
    let live = true;
    apiFetch('/messaging/channels')
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { whatsapp?: boolean } | null) => {
        if (!live || !c?.whatsapp) return;
        setWhatsappOn(true);
        if (!defaultEmail && defaultPhone) setChannel('WHATSAPP');
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [defaultEmail, defaultPhone]);
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; topup?: boolean } | null>(null);
  const [done, setDone] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          ...extraBody,
          channel,
          to: (channel === 'EMAIL' ? email : phone).trim() || undefined,
          message: channel === 'EMAIL' ? message.trim() || undefined : undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError({ text: body?.message ?? t('messaging.sendFailed'), topup: body?.error === 'InsufficientWhatsAppBalance' });
        return;
      }
      setDone(true);
    } catch {
      setError({ text: t('messaging.sendFailed') });
    } finally {
      setBusy(false);
    }
  }

  const tab = (c: Channel, Icon: typeof Mail, label: string, soon = false) => (
    <button
      type="button"
      onClick={() => setChannel(c)}
      disabled={soon}
      title={soon ? t('messaging.comingSoon') : undefined}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-md disabled:cursor-not-allowed disabled:text-gray-400 ${
        channel === c ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 enabled:hover:bg-gray-200'
      }`}
    >
      <Icon size={14} /> {label}
      {soon && <span className="text-[10px] font-normal">({t('messaging.comingSoon')})</span>}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 print:hidden" role="dialog" aria-modal="true">
      <div className="bg-white rounded-md shadow-lg w-full max-w-md p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-blue-700">
            <Send size={16} /> {title}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-black" aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div className="text-center py-4">
            <CheckCircle2 size={32} className="mx-auto text-green-600" />
            <p className="mt-2 text-sm">{channel === 'EMAIL' ? t('messaging.sentEmail', { to: email }) : t('messaging.sentWhatsapp', { to: phone })}</p>
            <button onClick={onClose} className="mt-4 text-sm px-4 py-2 rounded-md bg-blue-600 text-white font-semibold">
              {t('common.close')}
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-3">
              {tab('EMAIL', Mail, t('messaging.email'))}
              {tab('WHATSAPP', MessageCircle, t('messaging.whatsapp'), !whatsappOn)}
            </div>
            {channel === 'EMAIL' ? (
              <>
                <label className="text-xs text-gray-500 block mb-1">{t('messaging.emailTo')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 mb-3"
                />
                <label className="text-xs text-gray-500 block mb-1">{t('messaging.note')}</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 resize-none mb-3"
                />
              </>
            ) : (
              <>
                <label className="text-xs text-gray-500 block mb-1">{t('messaging.whatsappTo')}</label>
                <input
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0812…"
                  className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-blue-500 mb-2"
                />
                <p className="text-xs text-gray-500 mb-3">{t('messaging.whatsappCharged')}</p>
              </>
            )}
            {error && (
              <div className="bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-2.5 text-xs mb-3">
                {error.text}
                {error.topup && (
                  <Link href="/settings/whatsapp" className="block mt-1 font-semibold underline">
                    {t('messaging.topUp')}
                  </Link>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 text-sm px-3 py-2 rounded-md border-2 border-gray-300 font-semibold hover:bg-gray-100">
                {t('common.cancel')}
              </button>
              <button
                onClick={send}
                disabled={busy || (channel === 'EMAIL' ? !email.trim() : !phone.trim())}
                className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:bg-gray-300"
              >
                <Send size={14} /> {busy ? t('messaging.sending') : t('messaging.send')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
