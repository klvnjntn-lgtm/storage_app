'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ClipboardList, Receipt, Truck, Search, Loader2, CornerDownLeft } from 'lucide-react';
import { HubCard, HubGrid, HubPage, HubSection } from '@/app/components/shared/Hub';
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
    <HubPage path="~/sales" title={t('sales.overview.title')} subtitle={t('sales.overview.subtitle')}>
      {/* Cross-document search — quotation/order/invoice/DO number, or
          customer name, in one box. Picking a row from the dropdown
          opens that document directly. Enter with nothing highlighted
          (or the Enter badge) goes to /sales/search — the browsable
          results page, for when the query matches several things and
          you want to see them all rather than jump straight in. */}
      <HubSection index="01" label={t('common.hubSearch')}>
        <div data-tour="pos-search" className="relative">
          <div className="group relative flex items-center gap-3 rounded-xl border border-blue-500/20 bg-white px-4 py-3.5 shadow-sm transition-all focus-within:border-blue-500/50 focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.08)] hover:border-blue-500/35">
            <Search size={17} strokeWidth={2} className="text-blue-600/70 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => results.length > 0 && setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
              placeholder={t('sales.overview.searchPlaceholder')}
              className="flex-1 min-w-0 text-base sm:text-sm outline-none placeholder:text-gray-400 bg-transparent"
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
      </HubSection>

      <HubSection index="02" label={t('common.hubMenu')}>
        <HubGrid>
          {SALES_ITEMS.map(({ href, ...item }) => (
            <HubCard
              key={href}
              {...item}
              dataTour={`pos-card-${href.split('/').pop()}`}
              onClick={() => router.push(href)}
            />
          ))}
        </HubGrid>
      </HubSection>
    </HubPage>
  );
}