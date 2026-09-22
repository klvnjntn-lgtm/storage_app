'use client';

// Small client leaf so the print route's fallback message (shown when the
// server-side fetch in print/quotations/[id]/page.tsx fails) can still
// pick up the viewer's chosen language via LanguageProvider, which the
// (print) route layout wraps around all children.
import { useLanguage } from '@/app/context/LanguageContext';

export function QuotationPrintError() {
  const { t } = useLanguage();
  return <div style={{ padding: 24 }}>{t('sales.quotationTemplate.unableToLoad')}</div>;
}
