'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Search,
  LayoutDashboard,
  Settings,
  Tag,
  Upload as UploadIcon,
  Inbox,
  ArrowLeftRight,
  Hand,
  Box,
  Truck,
  LogOut,
  X,
  User,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

type Mode = 'RECEIVE' | 'MOVE' | 'PICK' | 'PACK' | 'SHIP';

type SearchResult = {
  products: any[];
  stocks: any[];
  locations: any[];
  events: any[];
};

type LicenseStatus = {
  valid: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';
  expiresAt: string | null;
  message?: string;
};

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin', label: 'Admin', icon: Settings },
  { href: '/labels', label: 'Labels', icon: Tag },
  { href: '/upload', label: 'Upload', icon: UploadIcon },
];

const MODES: {
  mode: Mode;
  label: string;
  subtitle: string;
  icon: typeof Inbox;
  className: string;
}[] = [
  {
    mode: 'RECEIVE',
    label: 'RECEIVE',
    subtitle: 'Incoming stock',
    icon: Inbox,
    className: 'bg-green-600 hover:bg-green-700 text-white',
  },
  {
    mode: 'MOVE',
    label: 'MOVE',
    subtitle: 'Relocate stock',
    icon: ArrowLeftRight,
    className: 'bg-blue-600 hover:bg-blue-700 text-white',
  },
  {
    mode: 'PICK',
    label: 'PICK',
    subtitle: 'Pick for order',
    icon: Hand,
    className: 'bg-yellow-400 hover:bg-yellow-500 text-black',
  },
  {
    mode: 'PACK',
    label: 'PACK',
    subtitle: 'Pack for shipment',
    icon: Box,
    className: 'bg-purple-600 hover:bg-purple-700 text-white',
  },
  {
    mode: 'SHIP',
    label: 'SHIP',
    subtitle: 'Outgoing stock',
    icon: Truck,
    className: 'bg-red-600 hover:bg-red-700 text-white',
  },
];

const statusStyle = (status: string) => {
  switch (status?.toUpperCase()) {
    case 'OPEN':
    case 'IN_PROGRESS':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'COMPLETE':
    case 'DONE':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'CANCELLED':
      return 'bg-gray-100 text-gray-600 border-gray-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
};

export default function Home() {
  const router = useRouter();
  const [sessions, setSessions] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await apiFetch('http://localhost:3000/auth/me');

        console.log("Status:", res.status);

        const text = await res.text();
        console.log("Body:", text);

        if (!res.ok) {
          return;
        }

        const data = JSON.parse(text);
        setProfile(data);
      } catch (err) {
        console.error(err);
      }
    }

    loadProfile();
  }, []);

  useEffect(() => {
    async function loadLicense() {
      try {
        // no auth needed — this endpoint is public so it works
        // even when the license itself is invalid
        const res = await fetch('http://localhost:3000/license/status');
        const json = await res.json();
        setLicense(json);
      } catch (err) {
        console.error('License status fetch failed:', err);
      }
    }

    loadLicense();
  }, []);

  const [showProfile, setShowProfile] = useState(false);

  const start = async (mode: Mode) => {
    const res = await apiFetch('http://localhost:3000/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: mode,
      }),
    });

    const session = await res.json();

    router.push(`/sessions/${session.id}`);
  };

  // debounce search
  useEffect(() => {
    if (!query.trim()) {
      setData(null);
      return;
    }

    const timeout = setTimeout(async () => {
      setLoading(true);

      try {
        const res = await apiFetch(
          `http://localhost:3000/products/search?q=${encodeURIComponent(query)}`
        );
        const json = await res.json();
        setData(json);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const loadSessions = async () => {
      const res = await apiFetch('http://localhost:3000/sessions');
      const data = await res.json();
      setSessions(data);
    };

    loadSessions();
  }, []);

  return (
    <main className="min-h-screen bg-white text-black flex flex-col">

      {/* Top Bar */}
      <div className="border-b-2 border-gray-300">
        <div className="max-w-5xl mx-auto px-5 py-4 flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Warehouse OS</h1>
            <p className="text-xs text-gray-500">Scanner Hub</p>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            {NAV.map(({ href, label, icon: Icon }) => (
              <button
                key={href}
                onClick={() => router.push(href)}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-gray-300 hover:bg-gray-100 font-medium"
              >
                <Icon size={16} strokeWidth={2} />
                {label}
              </button>
            ))}

            <button
              onClick={() => setShowProfile(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border border-gray-300 hover:bg-gray-100 font-medium"
            >  <User size={16} strokeWidth={2} />

              Account
            </button>
          </nav>
        </div>
      </div>

      {/* Account Modal */}
      {showProfile && profile && (
        <div className="fixed inset-0 bg-black/25 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-gray-100 p-6 w-[300px]">

            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <span className="text-[15px] font-medium">Account</span>
              <button
                onClick={() => setShowProfile(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Avatar + summary */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-sm font-medium text-blue-600 shrink-0">
                {profile.email.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{profile.email}</p>
                <p className="text-xs text-gray-500">{profile.role} · {profile.organization.name}</p>
              </div>
            </div>

            {/* License badge */}
            {license && (
              <div
                className={`flex items-center gap-2 rounded-md border px-3 py-2 mb-5 text-xs font-medium ${
                  license.valid
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {license.valid ? (
                  <ShieldCheck size={15} strokeWidth={2} />
                ) : (
                  <ShieldAlert size={15} strokeWidth={2} />
                )}
                <span>
                  {license.valid
                    ? 'License active'
                    : license.message || 'License invalid or expired'}
                </span>
              </div>
            )}

            {/* Details */}
            <div className="border-t border-gray-100 pt-4 space-y-2.5 mb-5">
              {[
                { label: 'Email', value: profile.email },
                { label: 'Role', value: profile.role },
                { label: 'Organization', value: profile.organization.name },
                ...(license
                  ? [{ label: 'License', value: license.status }]
                  : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-[13px] text-gray-400">{label}</span>
                  <span className="text-[13px] text-gray-700">{value}</span>
                </div>
              ))}
            </div>

            {/* Log out */}
            <button
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md border border-red-200 bg-red-50 text-red-600 text-[13px] font-medium hover:bg-red-100 transition-colors"
              onClick={() => {
                localStorage.removeItem('accessToken');
                window.location.href = '/login';
              }}
            >
              <LogOut size={14} />
              Log out
            </button>

          </div>
        </div>
      )}
      <div className="max-w-5xl mx-auto w-full px-5">

        {/* SEARCH BAR */}
        <div className="pt-5">
          <div className="relative">
            <Search
              size={18}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search SKU, product, rack, brand..."
              className="w-full pl-10 pr-4 py-3 rounded-md border border-gray-300 focus:outline-none focus:border-black text-base"
            />
          </div>

          {/* dropdown */}
          {query && (
            <div className="mt-2 bg-white border border-gray-300 rounded-md overflow-hidden shadow-sm">
              {loading && (
                <div className="p-3 text-sm text-gray-500">Searching...</div>
              )}

              {!loading && data && (
                <div className="max-h-72 overflow-auto text-sm">

                  {data.products?.length > 0 && (
                    <div className="p-2">
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">Products</p>
                      {data.products.map((p: any) => (
                        <div
                          key={p.id}
                          className="p-2 hover:bg-gray-100 rounded cursor-pointer"
                          onClick={() => router.push(`/products/${p.id}`)}
                        >
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-gray-500">{p.sku}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {data.stocks?.length > 0 && (
                    <div className="p-2 border-t border-gray-200">
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">Stock</p>
                      {data.stocks.map((s: any) => (
                        <div
                          key={s.id}
                          className="p-2 hover:bg-gray-100 rounded cursor-pointer"
                          onClick={() => router.push(`/products/${s.productId}`)}
                        >
                          <p>{s.product?.name}</p>
                          <p className="text-xs text-gray-500">{s.location?.name} • qty {s.quantity}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {data.locations?.length > 0 && (
                    <div className="p-2 border-t border-gray-200">
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">Locations</p>
                      {data.locations.map((l: any) => (
                        <div
                          key={l.id}
                          className="p-2 hover:bg-gray-100 rounded cursor-pointer"
                          onClick={() => router.push(`/locations/${l.id}`)}
                        >
                          {l.name}
                        </div>
                      ))}
                    </div>
                  )}

                  {data.events?.length > 0 && (
                    <div className="p-2 border-t border-gray-200">
                      <p className="text-xs text-gray-500 font-semibold mb-1 px-1 uppercase tracking-wide">Events</p>
                      {data.events.map((e: any) => (
                        <div
                          key={e.id}
                          className="p-2 text-xs text-gray-700 hover:bg-gray-100 rounded cursor-pointer"
                          onClick={() => router.push(`/products/${e.productId}/events`)}
                        >
                          {e.type} • {e.product?.name}
                        </div>
                      ))}
                    </div>
                  )}

                  {!loading && data &&
                    (data.products?.length ?? 0) === 0 &&
                    (data.stocks?.length ?? 0) === 0 &&
                    (data.locations?.length ?? 0) === 0 &&
                    (data.events?.length ?? 0) === 0 && (
                      <div className="p-3 text-sm text-gray-500">No results found</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RECENT SESSIONS */}
        <div className="pt-6">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Sessions</h2>
            <button
              onClick={() => router.push('/sessions')}
              className="text-xs text-gray-500 hover:text-black font-semibold"
            >
              View All →
            </button>
          </div>

          <div className="space-y-2">
            {sessions.slice(0, 5).map((s) => (
              <div
                key={s.id}
                onClick={() => router.push(`/sessions/${s.id}`)}
                className="bg-white border border-gray-300 rounded-md p-3 cursor-pointer hover:bg-gray-50 flex items-center justify-between"
              >
                <div>
                  <span className="font-semibold">{s.type}</span>
                  <p className="text-xs text-gray-500 mt-0.5">{s.totalItems} items</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-md border font-medium ${statusStyle(s.status)}`}>
                  {s.status}
                </span>
              </div>
            ))}

            {sessions.length === 0 && (
              <p className="text-sm text-gray-400">No recent sessions</p>
            )}
          </div>
        </div>

        {/* MAIN ACTIONS */}
        <div className="py-6 grid grid-cols-2 gap-3">
          {MODES.map(({ mode, label, subtitle, icon: Icon, className }) => (
            <button
              key={mode}
              onClick={() => start(mode)}
              className={`
                ${mode === 'RECEIVE' ? 'col-span-2' : ''}
                ${className}
                rounded-md p-5 text-left active:scale-[0.98] transition
                min-h-[92px] flex items-center gap-4
              `}
            >
              <Icon size={28} strokeWidth={2} className="shrink-0" />
              <div>
                <p className="text-xl font-bold leading-tight">{label}</p>
                <p className="text-sm opacity-90">{subtitle}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* FOOTER */}
      <div className="px-6 py-4 text-center text-xs text-gray-500 border-t-2 border-gray-300">
        Tap a mode → scan items instantly
      </div>

    </main>
  );
}