'use client';

import { useEffect, useRef, useState } from 'react';
import { Hash } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { readErrorMessage } from '@/lib/api-error';
import { useLanguage } from '@/app/context/LanguageContext';

type NumberingConfig = { format: string; isDefault: boolean; nextNumber: number; preview: string };

// Mirror of backend/src/shared/documents/document-number-format.util.ts,
// for the live preview only — the server validates and renders for real.
const TOKEN_RE = /\{([A-Z]+)(?::(\d+))?\}/g;

function renderFormat(format: string, seq: number, d: Date) {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return format.replace(TOKEN_RE, (_, name: string, pad?: string) =>
    name === 'SEQ'
      ? pad
        ? String(seq).padStart(Number(pad), '0')
        : String(seq)
      : name === 'YYYY'
        ? yyyy
        : name === 'YY'
          ? yyyy.slice(-2)
          : name === 'MM'
            ? mm
            : name === 'DD'
              ? dd
              : '',
  );
}

function formatLooksValid(format: string) {
  if (!format.trim() || format.length > 40) return false;
  const tokens = [...format.matchAll(TOKEN_RE)];
  const known = tokens.every(([, name, pad]) =>
    name === 'SEQ' ? pad === undefined || (Number(pad) >= 1 && Number(pad) <= 10) : ['YYYY', 'YY', 'MM', 'DD'].includes(name) && pad === undefined,
  );
  const seqCount = tokens.filter(([, name]) => name === 'SEQ').length;
  return known && seqCount === 1 && !/[{}]/.test(format.replace(TOKEN_RE, ''));
}

const TOKENS = ['{SEQ:5}', '{SEQ}', '{YYYY}', '{YY}', '{MM}', '{DD}'];

// Settings → Invoice numbering: the format new invoices are numbered with
// (e.g. ATL-{SEQ:5}) and the next running number. One counter backs every
// format, so changing the format continues the count instead of resetting.
export default function InvoiceNumberingSettings() {
  const { t } = useLanguage();
  const [config, setConfig] = useState<NumberingConfig | null>(null);
  const [format, setFormat] = useState('');
  const [nextNumber, setNextNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function apply(c: NumberingConfig) {
    setConfig(c);
    setFormat(c.format);
    setNextNumber(String(c.nextNumber));
  }

  useEffect(() => {
    let alive = true;
    apiFetch('/invoice-numbering')
      .then((res) => (res.ok ? res.json() : null))
      .then((c: NumberingConfig | null) => {
        if (alive && c) apply(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function insertToken(token: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? format.length;
    const end = el?.selectionEnd ?? format.length;
    setFormat(format.slice(0, start) + token + format.slice(end));
    setSaved(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    if (!config) return;
    setBusy(true);
    setError('');
    setSaved(false);
    const n = Number(nextNumber);
    try {
      const res = await apiFetch('/invoice-numbering', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Only send the number when it was changed, so a save that just
        // edits the format can't race an invoice issued meanwhile.
        body: JSON.stringify({ format: format.trim(), ...(n !== config.nextNumber ? { nextNumber: n } : {}) }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      apply(await res.json());
      setSaved(true);
    } catch {
      setError(t('settings.invoiceNumbering.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const n = Number(nextNumber);
  const numberValid = Number.isInteger(n) && config !== null && n >= config.nextNumber;
  const valid = formatLooksValid(format);
  const dirty = config !== null && (format.trim() !== config.format || n !== config.nextNumber);

  return (
    <section className="border border-blue-500/15 rounded-xl p-4 sm:p-5 bg-white shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <Hash size={16} strokeWidth={2} className="text-blue-700" aria-hidden="true" />
        <h2 className="font-bold">{t('settings.invoiceNumbering.heading')}</h2>
      </div>
      <p className="text-sm text-gray-600 max-w-xl">{t('settings.invoiceNumbering.description')}</p>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-2.5">
          {error}
        </p>
      )}

      {config === null ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && numberValid && dirty) save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">{t('settings.invoiceNumbering.formatLabel')}</span>
              <input
                ref={inputRef}
                value={format}
                maxLength={40}
                spellCheck={false}
                onChange={(e) => {
                  setFormat(e.target.value);
                  setSaved(false);
                }}
                className={`w-full font-mono border-2 rounded-md px-2.5 py-1.5 text-sm outline-none ${
                  valid ? 'border-gray-300 focus:border-blue-500' : 'border-red-300 focus:border-red-500'
                }`}
              />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">{t('settings.invoiceNumbering.nextNumberLabel')}</span>
              <input
                type="number"
                inputMode="numeric"
                min={config.nextNumber}
                step={1}
                value={nextNumber}
                onChange={(e) => {
                  setNextNumber(e.target.value);
                  setSaved(false);
                }}
                className={`w-full font-mono border-2 rounded-md px-2.5 py-1.5 text-sm outline-none ${
                  numberValid ? 'border-gray-300 focus:border-blue-500' : 'border-red-300 focus:border-red-500'
                }`}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-gray-500 mr-1">{t('settings.invoiceNumbering.insert')}</span>
            {TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => insertToken(token)}
                className="font-mono text-xs px-2 py-1 rounded-md border border-blue-500/20 text-blue-700 bg-blue-50 hover:bg-blue-100"
              >
                {token}
              </button>
            ))}
          </div>

          <ul className="text-xs text-gray-500 space-y-0.5">
            <li>
              <code className="font-mono">{'{SEQ:5}'}</code> {t('settings.invoiceNumbering.tokenSeqPadded')}
            </li>
            <li>
              <code className="font-mono">{'{SEQ}'}</code> {t('settings.invoiceNumbering.tokenSeq')}
            </li>
            <li>
              <code className="font-mono">{'{YYYY} {YY} {MM} {DD}'}</code> {t('settings.invoiceNumbering.tokenDate')}
            </li>
          </ul>

          <div className="rounded-lg border border-blue-500/15 bg-slate-50 px-3 py-2.5 text-sm">
            <span className="text-gray-500">{t('settings.invoiceNumbering.preview')} </span>
            <span className="font-mono font-semibold break-all">
              {valid && numberValid ? renderFormat(format.trim(), n, new Date()) : '—'}
            </span>
            {!valid && <p className="text-xs text-red-600 mt-1">{t('settings.invoiceNumbering.invalidFormat')}</p>}
            {valid && !numberValid && (
              <p className="text-xs text-red-600 mt-1">
                {t('settings.invoiceNumbering.numberTooLow', { min: String(config.nextNumber) })}
              </p>
            )}
          </div>

          <p className="text-xs text-gray-500 max-w-xl">
            {config.isDefault ? t('settings.invoiceNumbering.defaultNote') : t('settings.invoiceNumbering.continuousNote')}
          </p>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !valid || !numberValid || !dirty}
              className="text-sm font-medium bg-blue-600 text-white rounded-md px-3 py-2 hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? t('common.saving') : t('common.save')}
            </button>
            {saved && <span className="text-sm text-emerald-700">{t('settings.invoiceNumbering.saved')}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
