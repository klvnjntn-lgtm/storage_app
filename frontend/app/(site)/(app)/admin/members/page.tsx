'use client';

import { useEffect, useMemo, useState } from 'react';
import { display } from '@/lib/fonts';
import { Users, UserPlus, Lock, Unlock, Trash2, Search, AlertTriangle, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useLanguage } from '@/app/context/LanguageContext';
import { UserAvatar, userLabel } from '@/app/components/shared/UserAvatar';

type Role = 'ADMIN' | 'USER' | 'DRIVER';

type Member = {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  active: boolean;
  avatarUrl: string | null;
  createdAt: string;
  team: { id: string; name: string } | null;
};

type MembersResponse = { seatLimit: number; seatsUsed: number; members: Member[] };

const ROLES: Role[] = ['ADMIN', 'USER', 'DRIVER'];

const ROLE_STYLE: Record<Role, string> = {
  ADMIN: 'bg-purple-100 text-purple-800 border-purple-300',
  USER: 'bg-blue-100 text-blue-800 border-blue-300',
  DRIVER: 'bg-amber-100 text-amber-800 border-amber-300',
};

export default function MembersPage() {
  const { authorized, loading: authLoading } = useRequireAdmin();
  const { user: me } = useCurrentUser();
  const { t } = useLanguage();

  const [data, setData] = useState<MembersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('USER');
  const [inviting, setInviting] = useState(false);

  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeConfirmText, setRemoveConfirmText] = useState('');

  async function load() {
    try {
      const res = await apiFetch('/users');
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('admin.members.requestFailed', { status: res.status }));
        return;
      }
      setData(body);
    } catch {
      setError(t('admin.members.couldNotReachServer'));
    }
  }

  useEffect(() => {
    // load() only sets state after its fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (authorized) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.members ?? []).filter(
      (m) =>
        (!roleFilter || m.role === roleFilter) &&
        (!q || m.email.toLowerCase().includes(q) || (m.displayName ?? '').toLowerCase().includes(q)),
    );
  }, [data, query, roleFilter]);

  const seatsFull = !!data && data.seatsUsed >= data.seatLimit;

  async function run(memberId: string, path: string, init: RequestInit) {
    setBusyId(memberId);
    setError(null);
    try {
      const res = await apiFetch(path, init);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('admin.members.requestFailed', { status: res.status }));
        return false;
      }
      await load();
      return true;
    } catch {
      setError(t('admin.members.couldNotReachServer'));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function toggleActive(m: Member) {
    if (m.active && !confirm(t('admin.members.confirmLock', { name: userLabel(m) }))) return;
    run(m.id, `/users/${m.id}/active`, { method: 'PATCH', body: JSON.stringify({ active: !m.active }) });
  }

  function changeRole(m: Member, role: Role) {
    if (role === m.role) return;
    if (!confirm(t('admin.members.confirmRoleChange', { name: userLabel(m), role: t(`admin.members.role.${role}`) }))) return;
    run(m.id, `/users/${m.id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
  }

  async function confirmRemove() {
    if (!removing) return;
    const ok = await run(removing.id, `/users/${removing.id}`, { method: 'DELETE' });
    if (ok) setRemoving(null);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || invitePassword.length < 8) return;
    setInviting(true);
    setError(null);
    try {
      const res = await apiFetch('/auth/invite', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), password: invitePassword, role: inviteRole }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('admin.members.requestFailed', { status: res.status }));
        return;
      }
      setInviteEmail('');
      setInvitePassword('');
      setShowInvite(false);
      await load();
    } catch {
      setError(t('admin.members.couldNotReachServer'));
    } finally {
      setInviting(false);
    }
  }

  if (authLoading || !authorized) {
    return <p className="text-sm text-gray-500 p-6">{t('common.loading')}</p>;
  }

  const pct = data ? Math.min(100, (data.seatsUsed / Math.max(1, data.seatLimit)) * 100) : 0;

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <Users size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('admin.members.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('admin.members.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={() => setShowInvite((v) => !v)}
            disabled={seatsFull}
            title={seatsFull ? t('admin.members.seatsFullShort') : undefined}
            aria-label={t('admin.members.invite')}
            className="shrink-0 flex items-center gap-1.5 text-sm font-medium bg-blue-600 text-white rounded-md px-3 py-2 hover:bg-blue-700 disabled:opacity-50"
          >
            <UserPlus size={14} />
            <span className="hidden sm:inline">{t('admin.members.invite')}</span>
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-4">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>}

        {data && (
          <div className="bg-white border border-blue-500/15 rounded-xl p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">{t('admin.members.seatsTitle')}</p>
              <p className="text-sm tabular-nums">
                <span className={`text-lg font-bold ${seatsFull ? 'text-red-600' : 'text-gray-900'}`}>{data.seatsUsed}</span>
                <span className="text-gray-500"> / {data.seatLimit}</span>
              </p>
            </div>
            <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full ${seatsFull ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-blue-600'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">{t('admin.members.seatsHint')}</p>
            {seatsFull && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {t('admin.members.seatsFull')}
              </p>
            )}
          </div>
        )}

        {showInvite && !seatsFull && (
          <form
            onSubmit={handleInvite}
            className="bg-white border border-blue-500/15 rounded-xl p-4 shadow-sm grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end gap-3"
          >
            <label className="block">
              <span className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('admin.members.emailLabel')}
              </span>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('admin.members.passwordLabel')}
              </span>
              <input
                type="text"
                required
                minLength={8}
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                placeholder={t('admin.members.passwordPlaceholder')}
                className="w-full border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('admin.members.roleLabel')}
              </span>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="w-full border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`admin.members.role.${r}`)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim() || invitePassword.length < 8}
              className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2.5 sm:py-1.5 disabled:opacity-50"
            >
              {inviting ? t('admin.members.inviting') : t('admin.members.inviteSubmit')}
            </button>
          </form>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-md px-2.5 flex-1">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('admin.members.searchPlaceholder')}
              className="flex-1 min-w-0 py-2 sm:py-1.5 text-base sm:text-sm outline-none bg-transparent"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {(['', ...ROLES] as const).map((r) => (
              <button
                key={r || 'all'}
                onClick={() => setRoleFilter(r)}
                className={`shrink-0 text-xs font-medium rounded-full border px-3 py-1.5 ${
                  roleFilter === r ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {r ? t(`admin.members.role.${r}`) : t('admin.members.allRoles')}
                {data && (
                  <span className="ml-1 opacity-70">
                    {r ? data.members.filter((m) => m.role === r).length : data.members.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
          {!data && !error && <p className="text-sm text-gray-500 p-4">{t('common.loading')}</p>}
          {data && filtered.length === 0 && <p className="text-sm text-gray-500 p-4">{t('admin.members.empty')}</p>}
          {filtered.map((m) => {
            const isMe = m.id === me?.id;
            return (
              <div key={m.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <UserAvatar user={m} size={32} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold truncate">{userLabel(m)}</span>
                      {isMe && (
                        <span className="text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-300 rounded-full px-1.5">
                          {t('admin.members.you')}
                        </span>
                      )}
                    </div>
                    {m.displayName && <div className="text-xs text-gray-500 truncate">{m.email}</div>}
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${ROLE_STYLE[m.role]}`}>
                        {t(`admin.members.role.${m.role}`)}
                      </span>
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                          m.active ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300'
                        }`}
                      >
                        {m.active ? t('admin.members.active') : t('admin.members.locked')}
                      </span>
                      {m.team && <span className="text-[10px] text-gray-500">{m.team.name}</span>}
                    </div>
                  </div>
                </div>
                {!isMe && (
                  <div className="grid grid-cols-2 sm:flex items-center gap-2 pl-[42px] sm:pl-0 shrink-0">
                    <select
                      aria-label={t('admin.members.changeRole')}
                      value={m.role}
                      disabled={busyId === m.id}
                      onChange={(e) => changeRole(m, e.target.value as Role)}
                      className="col-span-2 sm:col-span-1 text-sm sm:text-xs font-medium rounded-md border border-gray-300 text-gray-700 bg-white px-2 min-h-10 sm:min-h-0 sm:py-1 disabled:opacity-50"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`admin.members.role.${r}`)}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={busyId === m.id || (!m.active && seatsFull)}
                      onClick={() => toggleActive(m)}
                      title={!m.active && seatsFull ? t('admin.members.seatsFullShort') : undefined}
                      className={`flex items-center justify-center gap-1 text-sm sm:text-xs font-medium rounded-md border px-2.5 min-h-10 sm:min-h-0 sm:py-1 disabled:opacity-50 ${
                        m.active ? 'border-gray-300 text-gray-700' : 'border-green-200 text-green-700'
                      }`}
                    >
                      {m.active ? <Lock size={12} /> : <Unlock size={12} />}
                      {m.active ? t('admin.members.lock') : t('admin.members.unlock')}
                    </button>
                    <button
                      disabled={busyId === m.id}
                      onClick={() => {
                        setRemoveConfirmText('');
                        setRemoving(m);
                      }}
                      className="flex items-center justify-center gap-1 text-sm sm:text-xs font-medium rounded-md border border-red-200 text-red-700 px-2.5 min-h-10 sm:min-h-0 sm:py-1 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      {t('admin.members.remove')}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {removing && (
        <div
          className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-[60] sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-member-title"
        >
          <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-lg w-full max-w-md p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 max-h-[90dvh] overflow-y-auto overscroll-contain">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid place-items-center w-9 h-9 rounded-full bg-red-100 text-red-600 shrink-0">
                  <AlertTriangle size={18} />
                </span>
                <h3 id="remove-member-title" className="text-base font-semibold">
                  {t('admin.members.removeTitle', { name: userLabel(removing) })}
                </h3>
              </div>
              <button onClick={() => setRemoving(null)} aria-label={t('common.cancel')} className="p-2 -m-2 text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
              <li>{t('admin.members.removeEffectAccess')}</li>
              <li>{t('admin.members.removeEffectSeat')}</li>
              <li>{t('admin.members.removeEffectRecords')}</li>
              <li>{t('admin.members.removeEffectRestore')}</li>
            </ul>
            <label className="block">
              <span className="text-xs text-gray-600">{t('admin.members.removeTypeToConfirm', { email: removing.email })}</span>
              <input
                value={removeConfirmText}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                onChange={(e) => setRemoveConfirmText(e.target.value)}
                placeholder={removing.email}
                className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
              />
            </label>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="grid grid-cols-2 sm:flex sm:justify-end gap-2">
              <button onClick={() => setRemoving(null)} className="text-sm font-medium border border-gray-300 rounded-md px-3 min-h-11 sm:min-h-0 sm:py-1.5">
                {t('common.cancel')}
              </button>
              <button
                disabled={removeConfirmText.trim().toLowerCase() !== removing.email.toLowerCase() || busyId === removing.id}
                onClick={confirmRemove}
                className="bg-red-600 text-white text-sm font-medium rounded-md px-3 min-h-11 sm:min-h-0 sm:py-1.5 hover:bg-red-700 disabled:opacity-50"
              >
                {busyId === removing.id ? t('admin.members.removing') : t('admin.members.removeConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
