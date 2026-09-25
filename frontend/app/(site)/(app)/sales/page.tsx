'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { display } from '@/lib/fonts';
import { FileText, ClipboardList, Receipt, Truck, ArrowUpRight, ShoppingCart, Search, Loader2, CornerDownLeft } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { formatIDR } from '@/lib/format';
import { useLanguage } from '@/app/context/LanguageContext';


type SalesSearchResultType = 'QUOTATION' | 'ORDER' | 'INVOICE' | 'DELIVERY_ORDER';

type SalesSearchResult = {
  id: string;
  type: SalesSearchResultType;
  number: string | null;
  customerName: string | null;
  status: string;
  total: string | null;
  createdAt: string;
};

// Maps a result's type to its detail route and display chrome. Keep this
// in sync with SALES_ITEMS above if any of those hrefs change, and with
// TYPE_META in /sales/search/page.tsx. Labels are resolved via t() inside
// the component since they're locale-dependent.
const TYPE_META: Record <
  SalesSearchResultType,
  {
    labelKey: string;
    icon: typeof FileText;
    path: string;
    accent: string;
  }
> = {
  QUOTATION: {
    labelKey: 'sales.overview.typeQuotation',
    icon: FileText,
    path: '/sales/quotations',
    accent: 'text-sky-600 bg-sky-50',
  },
  ORDER: {
    labelKey: 'sales.overview.typeOrder',
    icon: ClipboardList,
    path: '/sales/orders',
    accent: 'text-violet-600 bg-violet-50',
  },
  INVOICE: {
    labelKey: 'sales.overview.typeInvoice',
    icon: Receipt,
    path: '/sales/invoices',
    accent: 'text-fuchsia-600 bg-fuchsia-50',
  },
  DELIVERY_ORDER: {
    labelKey: 'sales.overview.typeDelivery',
    icon: Truck,
    path: '/sales/delivery-orders',
    accent: 'text-emerald-600 bg-emerald-50',
  },
};
const DEBOUNCE_MS = 350;

export default function SalesHome() {
  const router = useRouter();
  const { t, language } = useLanguage();

  const SALES_ITEMS = [
    {
      title: t('sales.overview.cardQuotationTitle'),
      description: t('sales.overview.cardQuotationDesc'),
      href: '/sales/quotations',
      icon: FileText,
      gradient: 'from-sky-500 to-blue-700',
    },
    {
      title: t('sales.overview.cardOrderTitle'),
      description: t('sales.overview.cardOrderDesc'),
      href: '/sales/orders',
      icon: ClipboardList,
      gradient: 'from-violet-500 to-purple-700',
    },
    {
      title: t('sales.overview.cardInvoiceTitle'),
      description: t('sales.overview.cardInvoiceDesc'),
      href: '/sales/invoices',
      icon: Receipt,
      gradient: 'from-fuchsia-500 to-pink-700',
    },
    {
      title: t('sales.overview.cardDeliveryTitle'),
      description: t('sales.overview.cardDeliveryDesc'),
      href: '/sales/delivery-orders',
      icon: Truck,
      gradient: 'from-emerald-500 to-teal-700',
    },
  ];

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SalesSearchResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setDropdownOpen(false);
      setNotFound(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/sales/search?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data: SalesSearchResult[] = await res.json();
          setResults(data);
          setDropdownOpen(data.length > 0);
          setHighlightIndex(0);
          setNotFound(data.length === 0 ? trimmed : null);
        }
      } catch {
        // Stay quiet on transient search errors — user can keep typing.
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Selecting a specific dropdown row already tells us exactly which
  // document it is, so — unlike Workshop's quick box, which always routes
  // through the lookup page since a vehicle has no separate "document" of
  // its own — this opens the document directly.
  function openResult(r: SalesSearchResult) {
    setDropdownOpen(false);
    router.push(`${TYPE_META[r.type].path}/${r.id}`);
  }

  // Enter with nothing specific highlighted (or the Enter badge itself):
  // same fallback as Workshop's box — land on the dedicated search/results
  // page instead of guessing which of several matches was meant.
  function goToSearchPage() {
    const trimmed = query.trim();
    router.push(trimmed ? `/sales/search?q=${encodeURIComponent(trimmed)}` : '/sales/search');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (dropdownOpen) setHighlightIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (dropdownOpen) setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (dropdownOpen && results[highlightIndex]) {
        openResult(results[highlightIndex]);
      } else {
        goToSearchPage();
      }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    }
  }

  return (
    <main
      className="min-h-screen text-black"
      style={{
        backgroundColor: '#f8fafc',
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.07) 1px, transparent 0)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Header — same outlined/blurred treatment as Workshop */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md px-3 sm:px-6 py-3 sm:py-5 border-b border-blue-500/15 shadow-[0_1px_0_0_rgba(37,99,235,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600/10 border border-blue-600/20 shrink-0">
              <ShoppingCart size={18} strokeWidth={2} className="text-blue-700" />
            </span>
            <div className="min-w-0">
              <h1 className={`${display.className} text-xl sm:text-2xl font-bold tracking-tight truncate`}>
                {t('sales.overview.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">{t('sales.overview.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 pt-6 sm:pt-8 pb-16">
        {/* Cross-document search — quotation/order/invoice/DO number, or
            customer name, in one box. Picking a row from the dropdown
            opens that document directly. Enter with nothing highlighted
            (or the Enter badge) goes to /sales/search — the browsable
            results page, for when the query matches several things and
            you want to see them all rather than jump straight in. */}
        <div className="mb-8 relative">
          <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => results.length > 0 && setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
              placeholder={t('sales.overview.searchPlaceholder')}
              className="flex-1 min-w-0 text-sm outline-none placeholder:text-gray-400 bg-transparent"
            />
            {searching ? (
              <Loader2 size={15} strokeWidth={2} className="text-blue-600/60 animate-spin shrink-0" />
            ) : (
              <button
                onClick={goToSearchPage}
                className="flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-600/10 border border-blue-600/20 rounded-md px-2 py-1 shrink-0 hover:bg-blue-600/15 transition-colors"
              >
                {t('sales.overview.enter')}
                <CornerDownLeft size={11} strokeWidth={2} />
              </button>
            )}
          </div>

          {dropdownOpen && results.length > 0 && (
            <div className="absolute left-0 right-0 mt-1.5 border border-blue-500/15 rounded-xl bg-white shadow-lg shadow-blue-900/5 overflow-hidden z-20 max-h-[70vh] overflow-y-auto">
              {results.map((r, idx) => {
                const meta = TYPE_META[r.type];
                const Icon = meta.icon;
                return (
                  <button
                    key={`${r.type}-${r.id}`}
                    onMouseDown={() => openResult(r)}
                    onMouseEnter={() => setHighlightIndex(idx)}
                    className={`w-full text-left px-3.5 py-3 flex items-center gap-3 ${
                      idx === highlightIndex ? 'bg-blue-50/70' : 'bg-white'
                    } ${idx !== results.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <span className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${meta.accent}`}>
                      <Icon size={15} strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{r.number ?? t('sales.overview.unnumbered')}</span>
                        <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide shrink-0">
                          {t(meta.labelKey)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {r.customerName ?? t('sales.overview.noCustomer')} ·{' '}
                        {new Date(r.createdAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US')}
                      </p>
                    </div>
                    {r.total != null && (
                      <span className="text-sm font-semibold shrink-0">{formatIDR(Number(r.total))}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {notFound && !dropdownOpen && (
            <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-md p-3 mt-1.5 text-center">
              {t('sales.overview.notFoundFor', { query: notFound })}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SALES_ITEMS.map(({ title, description, href, icon: Icon, gradient }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className={`group relative text-left rounded-xl p-5 sm:p-6 bg-gradient-to-br ${gradient} text-white shadow-md ring-1 ring-white/10 hover:shadow-lg hover:shadow-blue-900/10 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 min-h-[130px] sm:min-h-[150px] flex flex-col justify-between`}
            >
              <div className="flex items-start justify-between">
                <span className="shrink-0 rounded-lg bg-white/15 p-2.5 ring-1 ring-white/10">
                  <Icon size={22} strokeWidth={2} />
                </span>
                <ArrowUpRight
                  size={18}
                  strokeWidth={2}
                  className="opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                />
              </div>
              <div>
                <p className={`${display.className} text-lg sm:text-xl font-bold leading-tight`}>{title}</p>
                <p className="text-sm text-white/85 mt-0.5">{description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}