'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Wrench, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useDialog } from '@/app/components/shared/DialogProvider';

type Mechanic = { id: string; name: string };

// The mechanics written on the Mechanic account (Members). Each name is a Payroll employee marked as a
// mechanic — created here, so nobody types a "Mekanik" / "Mechanic" position — and only these are offered
// when the front desk picks who does a job.
export function MechanicNamesEditor() {
  const { t } = useLanguage();
  const dialog = useDialog();
  const m = (key: string, vars?: Record<string, string>) => t(`admin.members.mechanics.${key}`, vars);
  const [list, setList] = useState<Mechanic[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchList = () =>
    apiFetch('/mechanics').then((res) => (res.ok ? (res.json() as Promise<Mechanic[]>) : Promise.reject(new Error())));

  useEffect(() => {
    fetchList()
      .then(setList)
      .catch(() => setList([]));
  }, []);

  async function call(path: string, method: string, body?: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(path, { method, ...(body && { body: JSON.stringify(body) }) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? m('saveFailed'));
        return false;
      }
      setList(await fetchList().catch(() => list ?? []));
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!name.trim()) return;
    if (await call('/mechanics', 'POST', { name: name.trim() })) setName('');
  }

  async function rename(mech: Mechanic) {
    const next = await dialog.prompt(m('renamePrompt'), { defaultValue: mech.name });
    if (next?.trim() && next.trim() !== mech.name) await call(`/mechanics/${mech.id}`, 'PATCH', { name: next.trim() });
  }

  async function remove(mech: Mechanic) {
    if (await dialog.confirm(m('removeConfirm', { name: mech.name }), { danger: true })) {
      await call(`/mechanics/${mech.id}`, 'DELETE');
    }
  }

  return (
    <div className="w-full mt-2 sm:pl-[42px] space-y-2">
      <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
        <Wrench size={12} className="text-blue-700" />
        {m('heading')}
      </p>
      <p className="text-xs text-gray-500">{m('hint')}</p>
      <div className="flex flex-wrap gap-1.5">
        {list?.map((mech) => (
          <span key={mech.id} className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 pl-2.5 pr-1 py-0.5 text-xs text-blue-900">
            {mech.name}
            <button type="button" aria-label={m('rename')} disabled={busy} onClick={() => rename(mech)} className="p-0.5 text-blue-600 hover:text-blue-900">
              <Pencil size={11} />
            </button>
            <button type="button" aria-label={m('remove')} disabled={busy} onClick={() => remove(mech)} className="p-0.5 text-blue-600 hover:text-red-700">
              <X size={12} />
            </button>
          </span>
        ))}
        {list?.length === 0 && <span className="text-xs text-gray-400">{m('none')}</span>}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={m('namePlaceholder')}
          aria-label={m('namePlaceholder')}
          className="flex-1 min-w-0 border border-gray-300 rounded-md px-2.5 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium disabled:opacity-50"
        >
          <Plus size={14} />
          {m('add')}
        </button>
      </form>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
