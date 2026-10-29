// app/(app)/workshop/page.tsx
'use client';

import { useRouter } from 'next/navigation';
import { Car, Bell, Wrench } from 'lucide-react';
import { HubCard, HubGrid, HubPage, HubSection } from '@/app/components/shared/Hub';
import { VehicleQuickSearch } from '@/app/components/workshop/VehicleQuickSearch';
import { useLanguage } from '@/app/context/LanguageContext';


export default function WorkshopHome() {
  const router = useRouter();
  const { t } = useLanguage();

  const WORKSHOP_ITEMS = [
    {
      title: t('workshop.overview.vehiclesCardTitle'),
      description: t('workshop.overview.vehiclesCardDescription'),
      href: '/workshop/vehicles',
      icon: Car,
      gradient: 'from-sky-500 to-blue-700',
    },
    {
      title: t('workshop.overview.partsCardTitle'),
      description: t('workshop.overview.partsCardDescription'),
      href: '/workshop/parts',
      icon: Wrench,
      gradient: 'from-emerald-500 to-teal-700',
    },
    {
      title: t('workshop.overview.remindersCardTitle'),
      description: t('workshop.overview.remindersCardDescription'),
      href: '/workshop/reminders',
      icon: Bell,
      gradient: 'from-amber-500 to-orange-700',
    },
  ];

  return (
    <HubPage path="~/workshop" title={t('workshop.overview.title')} subtitle={t('workshop.overview.subtitle')}>
      <HubSection index="01" label={t('common.hubSearch')}>
        <VehicleQuickSearch dataTour="rms-search" />
      </HubSection>

      <HubSection index="02" label={t('common.hubMenu')}>
        <HubGrid>
          {WORKSHOP_ITEMS.map(({ href, ...item }) => (
            <HubCard
              key={href}
              {...item}
              dataTour={`rms-card-${href.split('/').pop()}`}
              onClick={() => router.push(href)}
            />
          ))}
        </HubGrid>
      </HubSection>
    </HubPage>
  );
}