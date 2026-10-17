'use client';

import { Rocket } from 'lucide-react';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useLanguage } from '@/app/context/LanguageContext';
import { PageFrame } from '@/app/components/shared/PageFrame';
import { OnboardingChecklist } from '@/app/components/onboarding/OnboardingChecklist';

export default function OnboardingPage() {
  const { authorized } = useRequireAdmin();
  const { t } = useLanguage();
  if (!authorized) return null;
  return (
    <PageFrame icon={Rocket} title={t('onboarding.pageTitle')} subtitle={t('onboarding.pageSubtitle')}>
      <OnboardingChecklist variant="page" />
    </PageFrame>
  );
}
