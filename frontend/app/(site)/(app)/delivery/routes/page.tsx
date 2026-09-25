'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Truck, Plus, UserPlus, Users, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import DatePicker from '@/app/components/shared/DatePicker';


type RouteStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

type RouteListItem = {
  id: string;
  name: string | null;
  routeDate: string;
  status: RouteStatus;
  driver: { id: string; email: string };
  _count: { stops: number };
};

type Team = { id: string; name: string; members: { id: string; email: string }[] };
type Driver = { id: string; email: string; team: { id: string; name: string } | null };

// Buckets drivers under their team name for <optgroup> rendering; drivers
// with no team fall under a synthetic "Unassigned" bucket, listed last.
function groupDriversByTeam(drivers: Driver[], unassignedLabel: string): { label: string; drivers: Driver[] }[] {
  const byTeam = new Map<string, Driver[]>();
  const unassigned: Driver[] = [];
  for (const d of drivers) {
    if (!d.team) {
      unassigned.push(d);
      continue;
    }
    const list = byTeam.get(d.team.name) ?? [];
    list.push(d);
    byTeam.set(d.team.name, list);
  }
  const groups = [...byTeam.entries()].map(([label, ds]) => ({ label, drivers: ds }));
  if (unassigned.length > 0) groups.push({ label: unassignedLabel, drivers: unassigned });
  return groups;
}

function statusStyle(status: RouteStatus) {
  switch (status) {
    case 'ACTIVE':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'COMPLETED':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-amber-100 text-amber-800 border-amber-300';
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function DeliveryRoutesPage() {
  const router = useRouter();
  const { t } = useLanguage();

  const [date, setDate] = useState(todayIso());
  const [driverFilter, setDriverFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [routes, setRoutes] = useState<RouteListItem[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showNewRoute, setShowNewRoute] = useState(false);
  const [newRouteDriverId, setNewRouteDriverId] = useState('');
  const [newRouteName, setNewRouteName] = useState('');
  const [creatingRoute, setCreatingRoute] = useState(false);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviting, setInviting] = useState(false);

  const [teams, setTeams] = useState<Team[]>([]);
  const [showTeams, setShowTeams] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [assigningDriverId, setAssigningDriverId] = useState<string | null>(null);

  async function loadDrivers() {
    const res = await apiFetch('/delivery-routes/drivers');
    if (res.ok) setDrivers(await res.json());
  }

  async function loadTeams() {
    const res = await apiFetch('/teams');
    if (res.ok) setTeams(await res.json());
  }

  async function handleCreateTeam() {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    setError(null);
    try {
      const res = await apiFetch('/teams', { method: 'POST', body: JSON.stringify({ name: newTeamName.trim() }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routes.requestFailed', { status: res.status }));
        return;
      }
      setNewTeamName('');
      await loadTeams();
    } catch {
      setError(t('delivery.routes.couldNotReachServer'));
    } finally {
      setCreatingTeam(false);
    }
  }

  async function handleDeleteTeam(teamId: string) {
    setError(null);
    const res = await apiFetch(`/teams/${teamId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.message ?? t('delivery.routes.requestFailed', { status: res.status }));
      return;
    }
    await Promise.all([loadTeams(), loadDrivers()]);
  }

  async function handleAssignDriver(driverId: string, teamId: string) {
    setAssigningDriverId(driverId);
    setError(null);
    try {
      const res = teamId
        ? await apiFetch(`/teams/${teamId}/drivers`, { method: 'POST', body: JSON.stringify({ driverId }) })
        : await apiFetch(`/teams/drivers/${driverId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.routes.requestFailed', { status: res.status }));
        return;
      }
      await Promise.all([loadTeams(), loadDrivers()]);
    } catch {
      setError(t('delivery.routes.couldNotReachServer'));
    } finally {
      setAssigningDriverId(null);
    }
  }

  async function loadRoutes() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (driverFilter) params.set('driverId', driverFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiFetch(`/delivery-routes?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.routes.requestFailed', { status: res.status }));
        setRoutes([]);
        return;
      }
      setRoutes(await res.json());
    } catch {
      setError(t('delivery.routes.couldNotReachServer'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDrivers();
    loadTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, driverFilter, statusFilter]);

  async function handleCreateRoute() {
    if (!newRouteDriverId || !date) return;
    setCreatingRoute(true);
    setError(null);
    try {
      const res = await apiFetch('/delivery-routes', {
        method: 'POST',
        body: JSON.stringify({ driverId: newRouteDriverId, routeDate: date, name: newRouteName.trim() || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routes.requestFailed', { status: res.status }));
        return;
      }
      setShowNewRoute(false);
      setNewRouteDriverId('');
      setNewRouteName('');
      router.push(`/delivery/routes/${body.id}`);
    } catch {
      setError(t('delivery.routes.couldNotReachServer'));
    } finally {
      setCreatingRoute(false);
    }
  }

  async function handleInviteDriver() {
    if (!inviteEmail.trim() || !invitePassword) return;
    setInviting(true);
    setError(null);
    try {
      const res = await apiFetch('/auth/invite', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), password: invitePassword, role: 'DRIVER' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routes.requestFailed', { status: res.status }));
        return;
      }
      setShowInvite(false);
      setInviteEmail('');
      setInvitePassword('');
      await loadDrivers();
    } catch {
      setError(t('delivery.routes.couldNotReachServer'));
    } finally {
      setInviting(false);
    }
  }

  const statusOptions: RouteStatus[] = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.08) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto flex items-center gap-2.5 min-w-0">
          <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
            <Truck size={18} strokeWidth={2} className="text-blue-700" />
          </span>
          <div className="min-w-0">
            <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
              {t('delivery.routes.title')}
            </h1>
            <p className="text-xs text-gray-500 truncate">{t('delivery.routes.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>
        )}

        <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
              {t('delivery.routes.dateLabel')}
            </label>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
              {t('delivery.routes.driverFilterLabel')}
            </label>
            <select
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm"
            >
              <option value="">{t('delivery.routes.allDrivers')}</option>
              {groupDriversByTeam(drivers, t('delivery.routes.unassigned')).map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.email}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
              {t('delivery.routes.statusFilterLabel')}
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm"
            >
              <option value="">{t('delivery.routes.allStatuses')}</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {t(`delivery.routes.statusLabel.${s}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex gap-2">
            <button
              onClick={() => router.push('/delivery/drivers')}
              className="flex items-center gap-1.5 text-sm font-medium border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50"
            >
              <Users size={14} />
              {t('delivery.driversAdmin.title')}
            </button>
            <button
              onClick={() => setShowTeams((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50"
            >
              <Users size={14} />
              {t('delivery.routes.teamsTitle')}
            </button>
            <button
              onClick={() => setShowInvite((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50"
            >
              <UserPlus size={14} />
              {t('delivery.routes.inviteDriver')}
            </button>
            <button
              onClick={() => setShowNewRoute((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium bg-blue-600 text-white rounded-md px-3 py-1.5 hover:bg-blue-700"
            >
              <Plus size={14} />
              {t('delivery.routes.newRoute')}
            </button>
          </div>
        </div>

        {showTeams && (
          <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <input
                type="text"
                placeholder={t('delivery.routes.teamNamePlaceholder')}
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm"
              />
              <button
                disabled={creatingTeam || !newTeamName.trim()}
                onClick={handleCreateTeam}
                className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-1.5 disabled:opacity-50"
              >
                {creatingTeam ? t('delivery.routes.creatingTeam') : t('delivery.routes.createTeam')}
              </button>
            </div>

            {teams.length === 0 && <p className="text-xs text-gray-500">{t('delivery.routes.noTeams')}</p>}
            {teams.map((team) => (
              <div key={team.id} className="border border-gray-200 rounded-md p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{team.name}</span>
                  <button
                    onClick={() => handleDeleteTeam(team.id)}
                    aria-label={t('delivery.routes.deleteTeam')}
                    className="p-1 rounded border border-red-200 text-red-600"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="mt-1.5 space-y-1">
                  {drivers
                    .filter((d) => d.team?.id === team.id)
                    .map((d) => (
                      <div key={d.id} className="flex items-center justify-between text-xs text-gray-600">
                        <span>{d.email}</span>
                        <button
                          disabled={assigningDriverId === d.id}
                          onClick={() => handleAssignDriver(d.id, '')}
                          className="text-red-600 disabled:opacity-50"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                </div>
                <select
                  value=""
                  onChange={(e) => e.target.value && handleAssignDriver(e.target.value, team.id)}
                  className="mt-1.5 w-full border border-gray-300 rounded-md px-2 py-1 text-xs"
                >
                  <option value="">{t('delivery.routes.selectDriver')}</option>
                  {drivers
                    .filter((d) => d.team?.id !== team.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.email}
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>
        )}

        {showInvite && (
          <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('delivery.routes.inviteEmailLabel')}
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('delivery.routes.invitePasswordLabel')}
              </label>
              <input
                type="text"
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm"
              />
            </div>
            <button
              disabled={inviting}
              onClick={handleInviteDriver}
              className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-1.5 disabled:opacity-50"
            >
              {inviting ? t('delivery.routes.inviting') : t('delivery.routes.inviteSubmit')}
            </button>
          </div>
        )}

        {showNewRoute && (
          <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('delivery.routes.driverLabel')}
              </label>
              <select
                value={newRouteDriverId}
                onChange={(e) => setNewRouteDriverId(e.target.value)}
                className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm min-w-[200px]"
              >
                <option value="">{t('delivery.routes.selectDriver')}</option>
                {groupDriversByTeam(drivers, t('delivery.routes.unassigned')).map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.email}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {drivers.length === 0 && <p className="text-xs text-gray-500 mt-1">{t('delivery.routes.noDrivers')}</p>}
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('delivery.routes.nameLabel')}
              </label>
              <input
                type="text"
                value={newRouteName}
                onChange={(e) => setNewRouteName(e.target.value)}
                className="border border-gray-300 rounded-md px-2.5 py-1.5 text-sm"
              />
            </div>
            <button
              disabled={creatingRoute || !newRouteDriverId}
              onClick={handleCreateRoute}
              className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-1.5 disabled:opacity-50"
            >
              {creatingRoute ? t('delivery.routes.creating') : t('delivery.routes.createRoute')}
            </button>
          </div>
        )}

        <div className="space-y-2">
          {!loading && routes.length === 0 && <p className="text-sm text-gray-500">{t('delivery.routes.noRoutes')}</p>}
          {routes.map((route) => (
            <button
              key={route.id}
              onClick={() => router.push(`/delivery/routes/${route.id}`)}
              className="w-full text-left bg-white rounded-lg border border-gray-200 p-3 hover:border-blue-300 transition-colors flex items-center justify-between"
            >
              <div>
                <div className="text-sm font-semibold">{route.name ?? route.driver.email}</div>
                <div className="text-xs text-gray-500">
                  {route.driver.email} · {t('delivery.routes.stopsCount', { count: route._count.stops })}
                </div>
              </div>
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusStyle(route.status)}`}
              >
                {t(`delivery.routes.statusLabel.${route.status}`)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
