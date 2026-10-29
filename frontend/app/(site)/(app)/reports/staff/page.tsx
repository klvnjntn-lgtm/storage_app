'use client';

import { useState } from 'react';
import { Award, Wrench, Truck } from 'lucide-react';
import { PageFrame } from '@/app/components/shared/PageFrame';
import { useLanguage } from '@/app/context/LanguageContext';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { useHasModule } from '@/lib/hooks/useHasModule';
import { isAdminRole } from '@/lib/roles';
import { getInitialParam } from '@/lib/useQuerySync';
import MechanicReports from '@/app/components/reports/MechanicReports';
import DeliveryReports from '@/app/components/reports/DeliveryReports';

type Tab = 'mechanics' | 'delivery';

// How the staff did, one tab per module that has staff to report on: mechanics (Workshop, admins only —
// it's what commission is paid on) and drivers (Delivery). An org with both sees both here, not two
// "Reports" in two menus.
export default function StaffReportsPage() {
  const { t } = useLanguage();
  const { user, loading } = useCurrentUser();
  const hasWorkshop = useHasModule('WORKSHOP_RMS');
  const hasDelivery = useHasModule('DELIVERY_DMS');
  const [picked, setPicked] = useState<Tab>(() => getInitialParam<Tab>('tab', 'mechanics'));

  const available: Tab[] = [
    ...(hasWorkshop && isAdminRole(user?.role) ? (['mechanics'] as const) : []),
    ...(hasDelivery ? (['delivery'] as const) : []),
  ];
  if (loading || !available.length) {
    return (
      <PageFrame icon={Award} title={t('nav.items.staffReports')}>
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </PageFrame>
    );
  }
  const tab = available.includes(picked) ? picked : available[0];

  function choose(next: Tab) {
    setPicked(next);
    // Each tab has its own period, so switching starts it fresh.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?tab=${next}`);
  }

  const tabs =
    available.length > 1 ? (
      <div role="tablist" className="flex gap-2 mt-4">
        {available.map((key) => {
          const Icon = key === 'mechanics' ? Wrench : Truck;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => choose(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                tab === key
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-gray-600 border-blue-500/20 hover:bg-blue-50 hover:border-blue-500/35'
              }`}
            >
              <Icon size={16} strokeWidth={2} />
              {t(`staffReports.tabs.${key}`)}
            </button>
          );
        })}
      </div>
    ) : null;

  // One header for every tab — same title, size and place; only the subtitle says what the tab covers.
  return (
    <PageFrame
      icon={Award}
      title={t('nav.items.staffReports')}
      subtitle={tab === 'mechanics' ? t('sales.performance.subtitle') : t('delivery.reports.subtitle')}
      below={tabs}
    >
      {tab === 'mechanics' ? <MechanicReports key="mechanics" /> : <DeliveryReports key="delivery" />}
    </PageFrame>
  );
}
