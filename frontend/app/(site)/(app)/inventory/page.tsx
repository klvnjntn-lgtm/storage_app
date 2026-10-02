'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Tag, ClipboardList, Warehouse, Package } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { HubCard, HubGrid, HubLocked, HubPage, HubSection } from '@/app/components/shared/Hub';


// Brighter, more saturated stops (400 -> 600) than the old 500 -> 700 —
// same hues, punchier and less muddy against the white cards.
const INVENTORY_ITEM_DEFS = [
  {
    key: 'stock' as const,
    href: '/inventory/stock',
    icon: LayoutDashboard,
    gradient: 'from-emerald-400 to-teal-600',
  },
  {
    key: 'products' as const,
    // FIX — was '/inventory/products', which doesn't exist. Product
    // management actually lives under Admin.
    href: '/admin/products',
    icon: Package,
    gradient: 'from-rose-400 to-red-600',
  },
  {
    key: 'sessions' as const,
    href: '/inventory/sessions',
    icon: ClipboardList,
    gradient: 'from-sky-400 to-blue-600',
  },
  {
    key: 'warehouse' as const,
    href: '/inventory/warehouse',
    icon: Warehouse,
    gradient: 'from-violet-400 to-purple-600',
  },
  {
    key: 'labels' as const,
    href: '/inventory/labels',
    icon: Tag,
    gradient: 'from-amber-400 to-orange-600',
  },
];

export default function InventoryHome() {
  const router = useRouter();
  const { t } = useLanguage();

  const INVENTORY_ITEMS = INVENTORY_ITEM_DEFS.map((item) => ({
    ...item,
    title: t(`inventory.home.items.${item.key}.title`),
    description: t(`inventory.home.items.${item.key}.description`),
  }));
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [modulesLoaded, setModulesLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/organizations/modules');
        if (!res.ok) return;
        const json = await res.json();
        setEnabledModules(Array.isArray(json) ? json : []);
      } catch (err) {
        console.error('Modules fetch failed:', err);
      } finally {
        setModulesLoaded(true);
      }
    })();
  }, []);

  const warehouseEnabled = enabledModules.includes('WAREHOUSE_OPS');

  return (
    <HubPage path="~/inventory" title={t('inventory.home.title')} subtitle={t('inventory.home.subtitle')}>
      {/* Wait for the modules fetch before deciding what to show, so we
          don't briefly flash the locked state before enabledModules
          resolves. */}
      {!modulesLoaded ? (
        <p className="mt-8 text-sm text-gray-400">{t('common.loading')}</p>
      ) : !warehouseEnabled ? (
        <HubLocked title={t('inventory.home.notEnabledTitle')} description={t('inventory.home.notEnabledDesc')} />
      ) : (
        <HubSection index="01" label={t('common.hubMenu')}>
          <HubGrid>
            {INVENTORY_ITEMS.map(({ key, href, ...item }) => (
              <HubCard key={key} {...item} onClick={() => router.push(href)} />
            ))}
          </HubGrid>
        </HubSection>
      )}
    </HubPage>
  );
}