'use client';

// Small client boundary so this fallback message can use useLanguage()
// even though it's rendered from an async server component
// (app/(print)/print/purchase-orders/[id]/page.tsx) that can't call
// hooks itself.
import { useLanguage } from '@/app/context/LanguageContext';

export function PrintLoadError() {
  const { t } = useLanguage();
  return <div style={{ padding: 24 }}>{t('purchasing.purchaseOrderDetail.printLoadFailed')}</div>;
}
