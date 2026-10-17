'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, Plus, Trash2, Copy, Webhook, Send } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatDMYTime } from '@/lib/dates';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useLanguage } from '@/app/context/LanguageContext';
import { Card, ErrorNote, PageFrame, Switch, btnPrimary, btnSecondary, btnDanger, inputCls, thCls, tdCls } from '@/app/components/shared/PageFrame';

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  role: 'ADMIN' | 'USER';
  readOnly: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
type Endpoint = { id: string; url: string; secret: string; events: string[]; active: boolean; disabledAt: string | null; consecutiveFailures: number };
type Delivery = { id: string; event: string; status: string; attempts: number; lastStatusCode: number | null; lastError: string | null; createdAt: string };

export default function IntegrationsPage() {
  const { authorized } = useRequireAdmin();
  const { t } = useLanguage();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState({ open: false, name: '', role: 'USER', readOnly: false });
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [newHook, setNewHook] = useState<{ open: boolean; url: string; events: string[] }>({ open: false, url: '', events: [] });
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const [k, w, e] = await Promise.all([
      apiFetch('/integrations-api/keys'),
      apiFetch('/integrations-api/webhooks'),
      apiFetch('/integrations-api/webhooks/events'),
    ]);
    if (k.ok) setKeys(await k.json());
    if (w.ok) setEndpoints(await w.json());
    if (e.ok) setEvents(await e.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (authorized) load();
  }, [authorized, load]);

  async function call(path: string, init: RequestInit) {
    setError(null);
    const res = await apiFetch(path, init);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.message ?? t('integrations.failed'));
      return null;
    }
    return body;
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    const body = await call('/integrations-api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: newKey.name.trim(), role: newKey.role, readOnly: newKey.readOnly }),
    });
    if (!body) return;
    setCreatedKey(body.key);
    setNewKey({ open: false, name: '', role: 'USER', readOnly: false });
    load();
  }

  async function revoke(k: ApiKey) {
    if (!confirm(t('integrations.revokeConfirm', { name: k.name }))) return;
    if (await call(`/integrations-api/keys/${k.id}`, { method: 'DELETE' })) load();
  }

  async function createHook(e: React.FormEvent) {
    e.preventDefault();
    if (await call('/integrations-api/webhooks', { method: 'POST', body: JSON.stringify({ url: newHook.url.trim(), events: newHook.events }) })) {
      setNewHook({ open: false, url: '', events: [] });
      load();
    }
  }

  async function toggleHook(ep: Endpoint) {
    if (await call(`/integrations-api/webhooks/${ep.id}`, { method: 'PATCH', body: JSON.stringify({ active: !ep.active }) })) load();
  }

  async function removeHook(ep: Endpoint) {
    if (!confirm(t('integrations.removeHookConfirm'))) return;
    if (await call(`/integrations-api/webhooks/${ep.id}`, { method: 'DELETE' })) load();
  }

  async function showDeliveries(ep: Endpoint) {
    const res = await apiFetch(`/integrations-api/webhooks/${ep.id}/deliveries`);
    if (res.ok) {
      const list = await res.json();
      setDeliveries((d) => ({ ...d, [ep.id]: list }));
    }
  }

  async function test(ep: Endpoint) {
    await call(`/integrations-api/webhooks/${ep.id}/test`, { method: 'POST' });
    showDeliveries(ep);
  }

  if (!authorized) return null;

  return (
    <PageFrame icon={KeyRound} title={t('integrations.title')} subtitle={t('integrations.subtitle')}>
      <ErrorNote message={error} />

      <Card
        title={t('integrations.keysTitle')}
        actions={
          <button className={btnSecondary} onClick={() => setNewKey({ ...newKey, open: !newKey.open })}>
            <Plus size={14} /> {t('integrations.newKey')}
          </button>
        }
      >
        <p className="text-xs text-gray-500 mb-3">{t('integrations.keysHint')}</p>
        {createdKey && (
          <div className="mb-3 bg-green-50 border border-green-300 rounded-md p-3">
            <p className="text-sm font-semibold text-green-900">{t('integrations.keyCreated')}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 font-mono text-xs break-all bg-white border border-green-200 rounded px-2 py-1">{createdKey}</code>
              <button className={btnSecondary} onClick={() => navigator.clipboard.writeText(createdKey)} aria-label={t('integrations.copy')}>
                <Copy size={14} />
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-600">{t('integrations.usage')}</p>
          </div>
        )}
        {newKey.open && (
          <form onSubmit={createKey} className="mb-3 grid sm:grid-cols-3 gap-2 items-center">
            <input required maxLength={100} placeholder={t('integrations.keyName')} value={newKey.name} onChange={(e) => setNewKey({ ...newKey, name: e.target.value })} className={inputCls} />
            <select value={newKey.role} onChange={(e) => setNewKey({ ...newKey, role: e.target.value })} className={inputCls}>
              <option value="USER">{t('integrations.roleUser')}</option>
              <option value="ADMIN">{t('integrations.roleAdmin')}</option>
            </select>
            <div className="flex items-center justify-between gap-3 rounded-md border border-gray-300 bg-white px-3 py-1.5">
              <span className="text-sm">{t('integrations.readOnly')}</span>
              <Switch checked={newKey.readOnly} onChange={(v) => setNewKey({ ...newKey, readOnly: v })} label={t('integrations.readOnly')} />
            </div>
            <div className="sm:col-span-3">
              <button className={btnPrimary}>{t('integrations.create')}</button>
            </div>
          </form>
        )}
        {keys.length === 0 ? (
          <p className="text-sm text-gray-500">{t('integrations.noKeys')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={thCls}>{t('integrations.keyName')}</th>
                  <th className={thCls}>{t('integrations.access')}</th>
                  <th className={thCls}>{t('integrations.lastUsed')}</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className={`border-t border-gray-100 ${k.revokedAt ? 'opacity-50' : ''}`}>
                    <td className={tdCls}>
                      {k.name} <span className="block font-mono text-xs text-gray-500">{k.prefix}…</span>
                    </td>
                    <td className={tdCls}>
                      {k.role === 'ADMIN' ? t('integrations.roleAdmin') : t('integrations.roleUser')}
                      {k.readOnly && ` · ${t('integrations.readOnly')}`}
                    </td>
                    <td className={tdCls}>{k.revokedAt ? t('integrations.revoked') : k.lastUsedAt ? formatDMYTime(new Date(k.lastUsedAt)) : t('integrations.never')}</td>
                    <td className={`${tdCls} text-right`}>
                      {!k.revokedAt && (
                        <button className="text-gray-400 hover:text-red-600" onClick={() => revoke(k)} aria-label={t('integrations.revoke')}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title={t('integrations.webhooksTitle')}
        actions={
          <button className={btnSecondary} onClick={() => setNewHook({ ...newHook, open: !newHook.open })}>
            <Plus size={14} /> {t('integrations.newWebhook')}
          </button>
        }
      >
        <p className="text-xs text-gray-500 mb-3">{t('integrations.webhooksHint')}</p>
        {newHook.open && (
          <form onSubmit={createHook} className="mb-4 space-y-2">
            <input required type="url" placeholder="https://example.com/waresys-webhook" value={newHook.url} onChange={(e) => setNewHook({ ...newHook, url: e.target.value })} className={inputCls} />
            <div className="flex flex-wrap gap-1.5">
              {events.map((ev) => {
                const on = newHook.events.includes(ev);
                return (
                  <button
                    key={ev}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setNewHook({ ...newHook, events: on ? newHook.events.filter((x) => x !== ev) : [...newHook.events, ev] })}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                      on ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:bg-blue-50'
                    }`}
                  >
                    {on ? <Check size={12} strokeWidth={3} /> : <Plus size={12} />}
                    {ev}
                  </button>
                );
              })}
            </div>
            <button className={btnPrimary} disabled={newHook.events.length === 0}>
              {t('integrations.create')}
            </button>
          </form>
        )}
        {endpoints.length === 0 ? (
          <p className="text-sm text-gray-500">{t('integrations.noWebhooks')}</p>
        ) : (
          <div className="space-y-3">
            {endpoints.map((ep) => (
              <div key={ep.id} className="border border-gray-200 rounded-md p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium break-all">
                      <Webhook size={14} className="shrink-0" /> {ep.url}
                    </p>
                    <p className="text-xs text-gray-500 font-mono">{ep.events.join(', ')}</p>
                    {ep.disabledAt && <p className="text-xs text-red-700">{t('integrations.autoDisabled')}</p>}
                    <p className="text-xs text-gray-500 mt-1">
                      {t('integrations.secret')}:{' '}
                      {revealed[ep.id] ? (
                        <code className="font-mono break-all">{ep.secret}</code>
                      ) : (
                        <button className="underline" onClick={() => setRevealed((r) => ({ ...r, [ep.id]: true }))}>
                          {t('integrations.reveal')}
                        </button>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className={btnSecondary} onClick={() => test(ep)}>
                      <Send size={14} /> {t('integrations.test')}
                    </button>
                    <button className={btnSecondary} onClick={() => toggleHook(ep)}>
                      {ep.active ? t('integrations.pause') : t('integrations.resume')}
                    </button>
                    <button className={btnDanger} onClick={() => removeHook(ep)} aria-label={t('integrations.remove')}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <button className="mt-2 text-xs text-blue-700 underline" onClick={() => showDeliveries(ep)}>
                  {t('integrations.showDeliveries')}
                </button>
                {deliveries[ep.id] && (
                  <ul className="mt-2 text-xs divide-y divide-gray-100">
                    {deliveries[ep.id].length === 0 && <li className="py-1 text-gray-500">{t('integrations.noDeliveries')}</li>}
                    {deliveries[ep.id].map((d) => (
                      <li key={d.id} className="py-1 flex flex-wrap gap-x-3">
                        <span className="font-mono">{d.event}</span>
                        <span className={d.status === 'SUCCEEDED' ? 'text-green-700' : d.status === 'FAILED' ? 'text-red-700' : 'text-amber-700'}>
                          {d.status} ({d.attempts})
                        </span>
                        <span className="text-gray-500">{formatDMYTime(new Date(d.createdAt))}</span>
                        {d.lastError && <span className="text-gray-500">{d.lastError}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        <details className="mt-4 text-xs text-gray-600">
          <summary className="cursor-pointer font-semibold">{t('integrations.verifyTitle')}</summary>
          <p className="mt-2">{t('integrations.verifyHint')}</p>
          <pre className="mt-2 bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto">{`const [t, v1] = header.split(',').map((p) => p.split('=')[1]);
const expected = crypto.createHmac('sha256', SECRET).update(\`\${t}.\${rawBody}\`).digest('hex');
const valid = expected === v1 && Math.abs(Date.now() / 1000 - Number(t)) < 300;`}</pre>
        </details>
      </Card>
    </PageFrame>
  );
}
