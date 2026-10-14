'use client';

import { useRouter } from 'next/navigation';
import { ClipboardList, Building2, PackageSearch, Undo2, FileCheck2 } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { HubCard, HubGrid, HubPage, HubSection } from '@/app/components/shared/Hub';


export default function PurchasingHome() {
  const router = useRouter();
  const { t } = useLanguage();

  // Brighter, more saturated stops (400 -> 600), matching inventory/page.tsx.
  const PURCHASING_ITEMS = [
    {
      title: t('purchasing.overview.poCardTitle'),
      description: t('purchasing.overview.poCardDescription'),
      href: '/purchasing/purchase-orders',
      icon: ClipboardList,
      gradient: 'from-amber-400 to-orange-600',
    },
    {
      title: t('purchasing.overview.suppliersCardTitle'),
      description: t('purchasing.overview.suppliersCardDescription'),
      href: '/purchasing/suppliers',
      icon: Building2,
      // hex, not slate/gray-*: the grays invert in dark mode (theme.css)
      gradient: 'from-[#94a3b8] to-[#4b5563]',
    },
    {
      title: t('purchasing.overview.reorderCardTitle'),
      description: t('purchasing.overview.reorderCardDescription'),
      href: '/purchasing/reorder',
      icon: PackageSearch,
      gradient: 'from-emerald-400 to-teal-600',
    },
    {
      title: t('purchasing.overview.returnsCardTitle'),
      description: t('purchasing.overview.returnsCardDescription'),
      href: '/purchasing/returns',
      icon: Undo2,
      gradient: 'from-rose-400 to-red-600',
    },
    {
      title: t('purchasing.overview.billsCardTitle'),
      description: t('purchasing.overview.billsCardDescription'),
      href: '/purchasing/bills',
      icon: FileCheck2,
      gradient: 'from-sky-400 to-indigo-600',
    },
  ];

  return (
    <HubPage path="~/purchasing" title={t('purchasing.overview.title')} subtitle={t('purchasing.overview.subtitle')}>
      <HubSection index="01" label={t('common.hubMenu')}>
        <HubGrid>
          {PURCHASING_ITEMS.map(({ href, ...item }) => (
            <HubCard key={href} {...item} onClick={() => router.push(href)} />
          ))}
        </HubGrid>
      </HubSection>
    </HubPage>
  );
}