'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Truck, Plus, UserPlus, Users, UserCog, Trash2, Sparkles } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useAuth } from '@/app/context/AuthContext';
import DatePicker from '@/app/components/shared/DatePicker';
import DriverPicker, { DriverAvatar, driverLabel } from '@/app/components/delivery/DriverPicker';
import TeamPicker, { teamLabel, toPickerTeam, type PickerTeam } from '@/app/components/delivery/TeamPicker';


type RouteStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

type RouteListItem = {
  id: string;
  name: string | null;
  routeDate: string;
  status: RouteStatus;
  team: PickerTeam;
  _count: { stops: number };
};

type Team = { id: string; name: string; members: { id: string; email: string; displayName: string | null }[] };
type Driver = { id: string; email: string; displayName: string | null; team: { id: string; name: string } | null };

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

// useSearchParams() needs a Suspense boundary (same as sales/orders/new).
export default function DeliveryRoutesPage() {
  return (
    <Suspense fallback={null}>
      <DeliveryRoutesPageInner />
    </Suspense>
  );
}

function DeliveryRoutesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'ADMIN';

  // Honors ?date= (e.g. coming back from "Optimize all teams").
  const [date, setDate] = useState(() => {
    const fromUrl = searchParams.get('date');
    return fromUrl && /^\d{4}-\d{2}-\d{2}$/.test(fromUrl) ? fromUrl : todayIso();
  });
  const [teamFilter, setTeamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [routes, setRoutes] = useState<RouteListItem[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showNewRoute, setShowNewRoute] = useState(false);
  const [newRouteTeamId, setNewRouteTeamId] = useState('');
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
      setShowTeams(false);
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
      if (teamFilter) params.set('teamId', teamFilter);
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
  }, [date, teamFilter, statusFilter]);

  async function handleCreateRoute() {
    if (!newRouteTeamId || !date) return;
    setCreatingRoute(true);
    setError(null);
    try {
      const res = await apiFetch('/delivery-routes', {
        method: 'POST',
        body: JSON.stringify({ teamId: newRouteTeamId, routeDate: date, name: newRouteName.trim() || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? t('delivery.routes.requestFailed', { status: res.status }));
        return;
      }
      setShowNewRoute(false);
      setNewRouteTeamId('');
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
  const pickerTeams = teams.map(toPickerTeam);
  const noDriver = t('delivery.teams.noDriver');

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: 'var(--page-bg)',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, var(--page-dots) 1px, transparent 0)',
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

        <div data-tour="dlv-routes-filters" className="border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
              {t('delivery.routes.dateLabel')}
            </label>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div className="min-w-0">
            <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
              {t('delivery.routes.teamFilterLabel')}
            </label>
            <TeamPicker
              teams={pickerTeams}
              value={teamFilter}
              onChange={setTeamFilter}
              clearLabel={t('delivery.routes.allTeams')}
            />
          </div>
          <div className="min-w-0">
            <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
              {t('delivery.routes.statusFilterLabel')}
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full sm:w-auto border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
            >
              <option value="">{t('delivery.routes.allStatuses')}</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {t(`delivery.routes.statusLabel.${s}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2 grid grid-cols-2 sm:flex sm:ml-auto gap-2">
            {/* Drivers, teams and invites are admin-only (the backend refuses staff). */}
            {isAdmin && (
              <>
                <button data-tour="dlv-routes-drivers"
                  onClick={() => router.push('/delivery/drivers')}
                  className="flex items-center justify-center gap-1.5 text-sm font-medium border border-gray-300 rounded-md px-3 py-2.5 sm:py-1.5 hover:bg-gray-50"
                >
                  <UserCog size={14} />
                  {t('delivery.driversAdmin.title')}
                </button>
                <button data-tour="dlv-routes-teams"
                  onClick={() => setShowTeams((v) => !v)}
                  className="flex items-center justify-center gap-1.5 text-sm font-medium border border-gray-300 rounded-md px-3 py-2.5 sm:py-1.5 hover:bg-gray-50"
                >
                  <Users size={14} />
                  {t('delivery.routes.teamsTitle')}
                </button>
                <button data-tour="dlv-routes-invite"
                  onClick={() => setShowInvite((v) => !v)}
                  className="flex items-center justify-center gap-1.5 text-sm font-medium border border-gray-300 rounded-md px-3 py-2.5 sm:py-1.5 hover:bg-gray-50"
                >
                  <UserPlus size={14} />
                  {t('delivery.routes.inviteDriver')}
                </button>
              </>
            )}
            <button data-tour="dlv-routes-plan"
              onClick={() => router.push(`/delivery/routes/plan?date=${date}`)}
              className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 text-sm font-medium border border-blue-600 text-blue-700 bg-blue-50 rounded-md px-3 py-2.5 sm:py-1.5 hover:bg-blue-100"
            >
              <Sparkles size={14} />
              {t('delivery.plan.openButton')}
            </button>
            <button data-tour="dlv-routes-new"
              onClick={() => setShowNewRoute((v) => !v)}
              className="order-first sm:order-none flex items-center justify-center gap-1.5 text-sm font-medium bg-blue-600 text-white rounded-md px-3 py-2.5 sm:py-1.5 hover:bg-blue-700"
            >
              <Plus size={14} />
              {t('delivery.routes.newRoute')}
            </button>
          </div>
        </div>

        {isAdmin && showTeams && (
          <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm space-y-3">
            <div className="flex items-end gap-2">
              <input
                type="text"
                placeholder={t('delivery.routes.teamNamePlaceholder')}
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                className="flex-1 sm:flex-none min-w-0 border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
              />
              <button
                disabled={creatingTeam || !newTeamName.trim()}
                onClick={handleCreateTeam}
                className="shrink-0 bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2.5 sm:py-1.5 disabled:opacity-50"
              >
                {creatingTeam ? t('delivery.routes.creatingTeam') : t('delivery.routes.createTeam')}
              </button>
            </div>

            <p className="text-xs text-gray-500">{t('delivery.routes.teamsHint')}</p>
            {teams.length === 0 && <p className="text-xs text-gray-500">{t('delivery.routes.noTeams')}</p>}
            {teams.map((team) => {
              const teamDriver = drivers.find((d) => d.team?.id === team.id);
              return (
              <div key={team.id} className="border border-gray-200 rounded-md p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{team.name}</span>
                  <button
                    onClick={() => handleDeleteTeam(team.id)}
                    aria-label={t('delivery.routes.deleteTeam')}
                    className="p-2 sm:p-1 rounded border border-red-200 text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {/* One team = one driver: show the driver, or a picker to set one. */}
                {teamDriver ? (
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-gray-600">
                    <span className="flex items-center gap-2 min-w-0">
                      <DriverAvatar driver={teamDriver} size={22} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-gray-800">{driverLabel(teamDriver)}</span>
                        {teamDriver.displayName && (
                          <span className="block truncate text-[11px] text-gray-400">{teamDriver.email}</span>
                        )}
                      </span>
                    </span>
                    <button
                      disabled={assigningDriverId === teamDriver.id}
                      onClick={() => handleAssignDriver(teamDriver.id, '')}
                      aria-label={t('delivery.routeDetail.remove')}
                      className="shrink-0 text-base leading-none px-2.5 py-1 sm:px-1 sm:py-0 text-red-600 disabled:opacity-50"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <DriverPicker
                    className="mt-2"
                    drivers={drivers.filter((d) => !d.team)}
                    value=""
                    onChange={(driverId) => driverId && handleAssignDriver(driverId, team.id)}
                    placeholder={t('delivery.routes.setTeamDriver')}
                    disabled={assigningDriverId !== null}
                  />
                )}
              </div>
              );
            })}
          </div>
        )}

        {isAdmin && showInvite && (
          <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm grid grid-cols-1 sm:flex sm:flex-wrap sm:items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('delivery.routes.inviteEmailLabel')}
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full sm:w-auto border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
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
                className="w-full sm:w-auto border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
              />
            </div>
            <button
              disabled={inviting}
              onClick={handleInviteDriver}
              className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2.5 sm:py-1.5 disabled:opacity-50"
            >
              {inviting ? t('delivery.routes.inviting') : t('delivery.routes.inviteSubmit')}
            </button>
          </div>
        )}

        {showNewRoute && (
          <div className="border border-blue-500/15 rounded-xl p-3 sm:p-4 bg-white shadow-sm grid grid-cols-1 sm:flex sm:flex-wrap sm:items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('delivery.routes.teamLabel')}
              </label>
              <TeamPicker teams={pickerTeams} value={newRouteTeamId} onChange={setNewRouteTeamId} />
              {teams.length === 0 && <p className="text-xs text-gray-500 mt-1">{t('delivery.routes.noTeams')}</p>}
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-blue-900/50 uppercase tracking-wide mb-1">
                {t('delivery.routes.nameLabel')}
              </label>
              <input
                type="text"
                value={newRouteName}
                onChange={(e) => setNewRouteName(e.target.value)}
                className="w-full sm:w-auto border border-gray-300 rounded-md px-2.5 py-2 sm:py-1.5 text-base sm:text-sm"
              />
            </div>
            <button
              disabled={creatingRoute || !newRouteTeamId}
              onClick={handleCreateRoute}
              className="bg-blue-600 text-white text-sm font-medium rounded-md px-3 py-2.5 sm:py-1.5 disabled:opacity-50"
            >
              {creatingRoute ? t('delivery.routes.creating') : t('delivery.routes.createRoute')}
            </button>
          </div>
        )}

        <div data-tour="dlv-routes-list" className="space-y-2">
          {!loading && routes.length === 0 && <p className="text-sm text-gray-500">{t('delivery.routes.noRoutes')}</p>}
          {routes.map((route) => (
            <button
              key={route.id}
              onClick={() => router.push(`/delivery/routes/${route.id}`)}
              className="w-full text-left bg-white rounded-lg border border-gray-200 p-3 hover:border-blue-300 transition-colors flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{route.name ?? route.team.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {teamLabel(route.team, noDriver)} · {t('delivery.routes.stopsCount', { count: route._count.stops })}
                </div>
              </div>
              <span
                className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusStyle(route.status)}`}
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
