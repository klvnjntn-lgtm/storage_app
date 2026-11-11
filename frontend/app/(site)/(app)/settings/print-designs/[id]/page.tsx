'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { Designer, type BusinessInfo } from '@/app/components/print-designer/Designer';
import type { Layout, PaperSize, PrintTemplate } from '@/lib/print-designer/types';

export default function PrintDesignEditorPage() {
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const { authorized } = useRequireAdmin(['ADMIN']);
  const [template, setTemplate] = useState<PrintTemplate | null>(null);
  const [business, setBusiness] = useState<BusinessInfo>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;
    (async () => {
      const [tplRes, orgRes] = await Promise.all([apiFetch(`/print-templates/${id}`), apiFetch('/organization/settings')]);
      if (cancelled) return;
      if (!tplRes.ok) {
        setError(t('printDesigner.editor.notFound'));
        return;
      }
      const tpl: PrintTemplate = await tplRes.json();
      setTemplate(tpl);
      if (orgRes.ok) {
        const org = await orgRes.json();
        setBusiness({
          branch: tpl.branch?.name ?? null,
          name: org.legalName || org.name,
          legalName: org.legalName,
          address: org.address,
          phone: org.phone,
          npwp: org.npwp,
          logoUrl: org.logoUrl,
        });
      }
    })().catch(() => !cancelled && setError(t('printDesigner.editor.notFound')));
    return () => {
      cancelled = true;
    };
  }, [authorized, id, t]);

  const save = useCallback(
    async (input: { name: string; paperSize: PaperSize; layout: Layout }) => {
      try {
        const res = await apiFetch(`/print-templates/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
        if (res.ok) return null;
        const body = await res.json().catch(() => null);
        return Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? t('printDesigner.list.saveFailed'));
      } catch {
        return t('printDesigner.list.saveFailed');
      }
    },
    [id, t],
  );

  if (!authorized) return null;
  if (error) return <p className="p-6 text-sm text-red-700">{error}</p>;
  if (!template) return <p className="p-6 text-sm text-gray-500">{t('common.loading')}</p>;
  return <Designer template={template} business={business} onSave={save} />;
}
