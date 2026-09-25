'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { Users, Lock, Unlock, Smartphone, Clock, Plus, Trash2, Check, X, Ban } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { getInitialNumberParam, useSyncQueryParams } from '@/lib/useQuerySync';
import Pagination from '@/app/components/shared/Pagination';


type Driver = { id: string; email: string; active: boolean; teamId: string | null; createdAt: string };

type DeviceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
type Device = { id: string; deviceId: string; label: string | null; userAgent: string | null; status: DeviceStatus; lastSeenAt: string };

type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
type AccessWindow = { dayOfWeek: DayOfWeek; startTime: string; endTime: string };

const DAYS: DayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function deviceStatusBadge(status: DeviceStatus, label: string) {
  const styles: Record<DeviceStatus, string> = {
    PENDING: 'bg-amber-100 text-amber-800 border-amber-300',
    APPROVED: 'bg-green-100 text-green-800 border-green-300',
    REJECTED: 'bg-red-100 text-red-800 border-red-300',
    REVOKED: 'bg-gray-100 text-gray-600 border-gray-300',
  };
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${styles[status]}`}>{label}</span>;
}

export default function DriversAdminPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, loading: userLoading } = useCurrentUser();

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [page, setPage] = useState(() => getInitialNumberParam('page', 1));
  const [pageSize, setPageSize] = useState(() => getInitialNumberParam('pageSize', 20));
  useSyncQueryParams({
    page: page !== 1 ? page : null,
    pageSize: pageSize !== 20 ? pageSize : null,
  });

  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [deviceBusyId, setDeviceBusyId] = useState<string | null>(null);

  const [windows, setWindows] = useState<AccessWindow[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    if (!userLoading && (!user || user.role !== 'ADMIN')) {
      router.replace('/home');
    }
  }, [userLoading, user, router]);

  async function loadDrivers() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/users/drivers');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.driversAdmin.requestFailed', { status: res.status }));
        return;
      }
      setDrivers(await res.json());
    } catch {
      setError(t('delivery.driversAdmin.couldNotReachServer'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.role === 'ADMIN') loadDrivers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const totalPages = Math.max(1, Math.ceil(drivers.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginatedDrivers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return drivers.slice(start, start + pageSize);
  }, [drivers, page, pageSize]);

  async function toggleActive(driver: Driver) {
    setBusyId(driver.id);
    setError(null);
    try {
      const res = await apiFetch(`/users/${driver.id}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !driver.active }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.driversAdmin.requestFailed', { status: res.status }));
        return;
      }
      await loadDrivers();
    } catch {
      setError(t('delivery.driversAdmin.couldNotReachServer'));
    } finally {
      setBusyId(null);
    }
  }

  async function loadDevices(driverId: string) {
    setDevicesLoading(true);
    try {
      const res = await apiFetch(`/users/${driverId}/devices`);
      if (res.ok) setDevices(await res.json());
    } finally {
      setDevicesLoading(false);
    }
  }

  async function loadSchedule(driverId: string) {
    setScheduleLoading(true);
    try {
      const res = await apiFetch(`/users/${driverId}/access-schedule`);
      if (res.ok) {
        const rows: AccessWindow[] = await res.json();
        setWindows(rows.map((r) => ({ dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime })));
      }
    } finally {
      setScheduleLoading(false);
    }
  }

  async function toggleExpanded(driver: Driver) {
    if (expandedId === driver.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(driver.id);
    setDevices([]);
    setWindows([]);
    await Promise.all([loadDevices(driver.id), loadSchedule(driver.id)]);
  }

  async function handleDeviceAction(driverId: string, deviceId: string, action: 'approve' | 'reject' | 'revoke') {
    setDeviceBusyId(deviceId);
    setError(null);
    try {
      const res = await apiFetch(`/devices/${deviceId}/${action}`, { method: 'PATCH' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.driversAdmin.requestFailed', { status: res.status }));
        return;
      }
      await loadDevices(driverId);
    } catch {
      setError(t('delivery.driversAdmin.couldNotReachServer'));
    } finally {
      setDeviceBusyId(null);
    }
  }

  function addWindow() {
    setWindows((w) => [...w, { dayOfWeek: 'MON', startTime: '08:00', endTime: '17:00' }]);
  }

  function updateWindow(idx: number, patch: Partial<AccessWindow>) {
    setWindows((w) => w.map((win, i) => (i === idx ? { ...win, ...patch } : win)));
  }

  function removeWindow(idx: number) {
    setWindows((w) => w.filter((_, i) => i !== idx));
  }

  async function saveSchedule(driverId: string) {
    setSavingSchedule(true);
    setError(null);
    try {
      const res = await apiFetch(`/users/${driverId}/access-schedule`, {
        method: 'PUT',
        body: JSON.stringify({ windows }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? t('delivery.driversAdmin.requestFailed', { status: res.status }));
        return;
      }
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1500);
    } catch {
      setError(t('delivery.driversAdmin.couldNotReachServer'));
    } finally {
      setSavingSchedule(false);
    }
  }

  if (userLoading || (user?.role === 'ADMIN' && loading)) {
    return <p className="text-sm text-gray-500 p-6">{t('common.loading')}</p>;
  }
  if (!user || user.role !== 'ADMIN') return null;

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
            <Users size={18} strokeWidth={2} className="text-blue-700" />
          </span>
          <div className="min-w-0">
            <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
              {t('delivery.driversAdmin.title')}
            </h1>
            <p className="text-xs text-gray-500 truncate">{t('delivery.driversAdmin.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-3">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">{error}</div>}

        {paginatedDrivers.map((driver) => (
          <div key={driver.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{driver.email}</div>
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                    driver.active ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300'
                  }`}
                >
                  {driver.active ? t('delivery.driversAdmin.active') : t('delivery.driversAdmin.locked')}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleExpanded(driver)}
                  className="flex items-center gap-1 text-xs font-medium border border-blue-200 text-blue-700 rounded px-2 py-1"
                >
                  {expandedId === driver.id ? t('delivery.driversAdmin.close') : t('delivery.driversAdmin.manage')}
                </button>
                <button
                  disabled={busyId === driver.id}
                  onClick={() => toggleActive(driver)}
                  className={`flex items-center gap-1 text-xs font-medium rounded px-2 py-1 border disabled:opacity-50 ${
                    driver.active ? 'border-red-200 text-red-700' : 'border-green-200 text-green-700'
                  }`}
                >
                  {driver.active ? <Lock size={12} /> : <Unlock size={12} />}
                  {driver.active ? t('delivery.driversAdmin.lock') : t('delivery.driversAdmin.unlock')}
                </button>
              </div>
            </div>

            {expandedId === driver.id && (
              <div className="border-t border-gray-100 p-3 space-y-4 bg-gray-50/50">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 mb-2">
                    <Smartphone size={13} />
                    {t('delivery.driversAdmin.devicesTitle')}
                  </div>
                  {devicesLoading && <p className="text-xs text-gray-400">{t('common.loading')}</p>}
                  {!devicesLoading && devices.length === 0 && (
                    <p className="text-xs text-gray-400">{t('delivery.driversAdmin.noDevices')}</p>
                  )}
                  <div className="space-y-1.5">
                    {devices.map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded-md p-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {deviceStatusBadge(d.status, t(`delivery.driversAdmin.deviceStatus.${d.status}`))}
                            <span className="text-[11px] text-gray-400 truncate">{d.userAgent ?? d.deviceId}</span>
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            {t('delivery.driversAdmin.lastSeen')}: {new Date(d.lastSeenAt).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {d.status === 'PENDING' && (
                            <>
                              <button
                                disabled={deviceBusyId === d.id}
                                onClick={() => handleDeviceAction(driver.id, d.id, 'approve')}
                                className="p-1 rounded border border-green-200 text-green-700 disabled:opacity-40"
                                aria-label={t('delivery.driversAdmin.approve')}
                              >
                                <Check size={12} />
                              </button>
                              <button
                                disabled={deviceBusyId === d.id}
                                onClick={() => handleDeviceAction(driver.id, d.id, 'reject')}
                                className="p-1 rounded border border-red-200 text-red-700 disabled:opacity-40"
                                aria-label={t('delivery.driversAdmin.reject')}
                              >
                                <X size={12} />
                              </button>
                            </>
                          )}
                          {d.status === 'APPROVED' && (
                            <button
                              disabled={deviceBusyId === d.id}
                              onClick={() => handleDeviceAction(driver.id, d.id, 'revoke')}
                              className="p-1 rounded border border-gray-300 text-gray-600 disabled:opacity-40"
                              aria-label={t('delivery.driversAdmin.revoke')}
                            >
                              <Ban size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 mb-1">
                    <Clock size={13} />
                    {t('delivery.driversAdmin.accessHoursTitle')}
                  </div>
                  <p className="text-[11px] text-gray-400 mb-2">{t('delivery.driversAdmin.accessHoursHint')}</p>
                  {scheduleLoading && <p className="text-xs text-gray-400">{t('common.loading')}</p>}
                  <div className="space-y-1.5">
                    {windows.map((w, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-md p-1.5">
                        <select
                          value={w.dayOfWeek}
                          onChange={(e) => updateWindow(idx, { dayOfWeek: e.target.value as DayOfWeek })}
                          className="border border-gray-300 rounded px-1.5 py-1 text-xs"
                        >
                          {DAYS.map((d) => (
                            <option key={d} value={d}>
                              {t(`delivery.driversAdmin.day.${d}`)}
                            </option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={w.startTime}
                          onChange={(e) => updateWindow(idx, { startTime: e.target.value })}
                          className="border border-gray-300 rounded px-1.5 py-1 text-xs"
                        />
                        <span className="text-xs text-gray-400">–</span>
                        <input
                          type="time"
                          value={w.endTime}
                          onChange={(e) => updateWindow(idx, { endTime: e.target.value })}
                          className="border border-gray-300 rounded px-1.5 py-1 text-xs"
                        />
                        <button
                          onClick={() => removeWindow(idx)}
                          aria-label={t('delivery.driversAdmin.remove')}
                          className="p-1 rounded border border-red-200 text-red-600 ml-auto"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={addWindow}
                      className="flex items-center gap-1 text-xs font-medium border border-gray-300 rounded px-2 py-1"
                    >
                      <Plus size={12} />
                      {t('delivery.driversAdmin.addWindow')}
                    </button>
                    <button
                      disabled={savingSchedule}
                      onClick={() => saveSchedule(driver.id)}
                      className="text-xs font-medium bg-blue-600 text-white rounded px-3 py-1 disabled:opacity-50"
                    >
                      {savingSchedule ? t('delivery.driversAdmin.saving') : savedTick ? t('delivery.driversAdmin.saved') : t('delivery.driversAdmin.save')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {drivers.length > 0 && (
          <div className="pt-1">
            <Pagination
              page={page}
              pageSize={pageSize}
              totalItems={drivers.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>
    </main>
  );
}
