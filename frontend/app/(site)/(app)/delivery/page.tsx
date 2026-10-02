'use client';

import { useRouter } from 'next/navigation';
import { Navigation, BarChart3, Users, TrendingUp } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { useHasModule } from '@/lib/hooks/useHasModule';
import { useCurrentUser } from '@/lib/hooks/useCurrentUser';
import { HubCard, HubGrid, HubLocked, HubPage, HubSection } from '@/app/components/shared/Hub';


// Same "local component + data array" hub shape as inventory/page.tsx and
// sales/page.tsx — one card grid, not a dashboard of its own.
const DELIVERY_ITEM_DEFS = [
  { key: 'routes' as const, href: '/delivery/routes', icon: Navigation, gradient: 'from-blue-500 to-indigo-700', adminOnly: false },
  { key: 'monitoring' as const, href: '/delivery/monitoring', icon: BarChart3, gradient: 'from-cyan-500 to-blue-700', adminOnly: false },
  { key: 'reports' as const, href: '/delivery/reports', icon: TrendingUp, gradient: 'from-sky-500 to-blue-800', adminOnly: false },
  { key: 'drivers' as const, href: '/delivery/drivers', icon: Users, gradient: 'from-violet-500 to-purple-800', adminOnly: true },
];

export default function DeliveryHome() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, loading: userLoading } = useCurrentUser();
  const hasDelivery = useHasModule('DELIVERY_DMS');

  const DELIVERY_ITEMS = DELIVERY_ITEM_DEFS.filter((item) => !item.adminOnly || user?.role === 'ADMIN').map(
    (item) => ({
      ...item,
      title: t(`delivery.home.items.${item.key}.title`),
      description: t(`delivery.home.items.${item.key}.description`),
    }),
  );

  return (
    <HubPage path="~/delivery" title={t('delivery.home.title')} subtitle={t('delivery.home.subtitle')}>
      {/* Wait for the module-status fetch before deciding what to show,
          so we don't briefly flash the locked state before hasDelivery
          resolves — same pattern as inventory/page.tsx. */}
      {!userLoading && !hasDelivery ? (
        <HubLocked title={t('delivery.home.notEnabledTitle')} description={t('delivery.home.notEnabledDesc')} />
      ) : (
        <HubSection index="01" label={t('common.hubMenu')}>
          <HubGrid>
            {DELIVERY_ITEMS.map(({ key, href, title, description, icon, gradient }) => (
              <HubCard
                key={key}
                title={title}
                description={description}
                icon={icon}
                gradient={gradient}
                dataTour={`dlv-card-${href.split('/').pop()}`}
                onClick={() => router.push(href)}
              />
            ))}
          </HubGrid>
        </HubSection>
      )}
    </HubPage>
  );
}
