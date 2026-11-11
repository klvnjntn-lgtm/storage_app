'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, LayoutTemplate, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { useLanguage } from '@/app/context/LanguageContext';
import { useRequireAdmin } from '@/lib/hooks/useRequireAdmin';
import { useBranches } from '@/lib/hooks/useBranches';
import { useHasModule } from '@/lib/hooks/useHasModule';
import { useDialog } from '@/app/components/shared/DialogProvider';
import { PageFrame, Card, ErrorNote, TabBar, btnPrimary, btnSecondary, inputCls } from '@/app/components/shared/PageFrame';
import { blankLayout, starterLayout } from '@/lib/print-designer/starters';
import type { DocType, PaperSize, PrintTemplate } from '@/lib/print-designer/types';
import { formatDMY } from '@/lib/dates';

function errorText(body: { message?: string | string[] } | null, fallback: string) {
  if (Array.isArray(body?.message)) return body.message.join(', ');
  return body?.message ?? fallback;
}

// Settings → Print designs: each branch's own layouts for invoices,
// quotations and job cards. Several per document; the default prints when
// nobody picks one (and on PDFs sent by WhatsApp or email).
export default function PrintDesignsPage() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const dialog = useDialog();
  const { user, authorized } = useRequireAdmin(['ADMIN']);
  const { branches, multiBranch } = useBranches();
  const hasInvoicePos = useHasModule('INVOICE_POS');
  const hasWorkshop = useHasModule('WORKSHOP_RMS');

  const docTabs = useMemo(
    () =>
      [
        ...(hasInvoicePos
          ? [
              { key: 'INVOICE' as DocType, label: t('printDesigner.docTypes.INVOICE') },
              { key: 'QUOTATION' as DocType, label: t('printDesigner.docTypes.QUOTATION') },
            ]
          : []),
        ...(hasWorkshop ? [{ key: 'WORK_ORDER' as DocType, label: t('printDesigner.docTypes.WORK_ORDER') }] : []),
      ],
    [hasInvoicePos, hasWorkshop, t],
  );
  const [picked, setDocType] = useState<DocType>('INVOICE');
  const docType: DocType = docTabs.some((d) => d.key === picked) ? picked : (docTabs[0]?.key ?? 'INVOICE');

  // MASTER picks the branch; everyone else works on their own.
  const [branchId, setBranchId] = useState<string>('');
  const activeBranch = user?.role === 'MASTER' ? branchId || branches[0]?.id || '' : (user?.branch?.id ?? '');

  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftPaper, setDraftPaper] = useState<PaperSize>('A4');
  const [draftStart, setDraftStart] = useState<'standard' | 'blank'>('standard');

  const fetchList = useCallback(async (): Promise<PrintTemplate[]> => {
    const q = new URLSearchParams({ docType, ...(activeBranch ? { branchId: activeBranch } : {}) });
    const res = await apiFetch(`/print-templates?${q}`);
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }, [docType, activeBranch]);

  const load = useCallback(async () => {
    setTemplates(await fetchList());
    setLoaded(true);
  }, [fetchList]);

  useEffect(() => {
    if (!authorized) return;
    let current = true;
    (async () => {
      const list = await fetchList().catch(() => null);
      if (!current) return;
      if (list) setTemplates(list);
      else setError(t('printDesigner.list.loadFailed'));
      setLoaded(true);
    })();
    return () => {
      current = false;
    };
  }, [authorized, fetchList, t]);

  async function call(path: string, method: string, payload?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(path, { method, body: payload ? JSON.stringify(payload) : undefined });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorText(body, t('printDesigner.list.saveFailed')));
        return null;
      }
      await load();
      return body;
    } catch {
      setError(t('printDesigner.list.saveFailed'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const lang = language === 'id' ? 'id' : 'en';
    const layout = draftStart === 'blank' ? blankLayout(docType, draftPaper, lang) : starterLayout(docType, draftPaper, lang);
    const created = await call('/print-templates', 'POST', {
      docType,
      name: draftName.trim() || t(`printDesigner.docTypes.${docType}`),
      paperSize: draftPaper,
      layout,
      branchId: activeBranch || undefined,
    });
    if (created?.id) router.push(`/settings/print-designs/${created.id}`);
  }

  async function copyToBranch(tpl: PrintTemplate) {
    const target = await dialog.choose(
      t('printDesigner.list.copyToBranchPrompt'),
      branches.map((b) => ({ value: b.id, label: b.name, disabled: b.id === tpl.branchId })),
    );
    if (target) await call(`/print-templates/${tpl.id}/duplicate`, 'POST', { branchId: target, name: tpl.name });
  }

  async function remove(tpl: PrintTemplate) {
    if (!(await dialog.confirm(t('printDesigner.list.deleteConfirm', { name: tpl.name }), { danger: true }))) return;
    await call(`/print-templates/${tpl.id}`, 'DELETE');
  }

  if (!authorized) return null;

  return (
    <PageFrame
      icon={LayoutTemplate}
      title={t('printDesigner.list.title')}
      subtitle={t('printDesigner.list.subtitle')}
      actions={
        <button className={btnPrimary} onClick={() => setCreating(true)} disabled={busy || docTabs.length === 0}>
          <Plus size={16} />
          {t('printDesigner.list.new')}
        </button>
      }
      below={docTabs.length > 1 ? <TabBar tabs={docTabs} value={docType} onChange={setDocType} /> : undefined}
    >
      <ErrorNote message={error} />

      {multiBranch && (
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium text-gray-700">{t('printDesigner.list.branch')}</span>
          <select className={`${inputCls} max-w-xs`} value={activeBranch} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {creating && (
        <Card
          title={t('printDesigner.list.newTitle', { doc: t(`printDesigner.docTypes.${docType}`) })}
          actions={
            <button className="p-1 text-gray-500 hover:text-black" onClick={() => setCreating(false)} aria-label={t('common.close')}>
              <X size={16} />
            </button>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="block font-medium text-gray-700 mb-1">{t('printDesigner.list.name')}</span>
              <input
                className={inputCls}
                value={draftName}
                maxLength={100}
                placeholder={t(`printDesigner.docTypes.${docType}`)}
                onChange={(e) => setDraftName(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium text-gray-700 mb-1">{t('printDesigner.list.paper')}</span>
              <select className={inputCls} value={draftPaper} onChange={(e) => setDraftPaper(e.target.value as PaperSize)}>
                <option value="A4">{t('printDesigner.paper.A4')}</option>
                <option value="A5">{t('printDesigner.paper.A5')}</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block font-medium text-gray-700 mb-1">{t('printDesigner.list.startFrom')}</span>
              <select className={inputCls} value={draftStart} onChange={(e) => setDraftStart(e.target.value as 'standard' | 'blank')}>
                <option value="standard">{t('printDesigner.list.startStandard')}</option>
                <option value="blank">{t('printDesigner.list.startBlank')}</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button className={btnPrimary} onClick={create} disabled={busy}>
              {t('printDesigner.list.createAndOpen')}
            </button>
          </div>
        </Card>
      )}

      <Card>
        {loaded && templates.length === 0 ? (
          <div className="text-sm text-gray-600 py-6 text-center">
            <p>{t('printDesigner.list.empty')}</p>
            <p className="text-gray-500 mt-1">{t('printDesigner.list.emptyHint')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {templates.map((tpl) => (
              <li key={tpl.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/settings/print-designs/${tpl.id}`} className="font-semibold hover:underline truncate">
                      {tpl.name}
                    </Link>
                    <span className="text-xs rounded border border-gray-300 px-1.5 py-0.5 text-gray-600">{tpl.paperSize}</span>
                    {tpl.isDefault && (
                      <span className="text-xs rounded bg-blue-600/10 text-blue-800 px-1.5 py-0.5 font-medium">
                        {t('printDesigner.list.default')}
                      </span>
                    )}
                  </div>
                  {tpl.updatedAt && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t('printDesigner.list.updated', { date: formatDMY(new Date(tpl.updatedAt)) })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Link href={`/settings/print-designs/${tpl.id}`} className={btnSecondary}>
                    <Pencil size={14} />
                    {t('common.edit')}
                  </Link>
                  {!tpl.isDefault && (
                    <button className={btnSecondary} disabled={busy} onClick={() => call(`/print-templates/${tpl.id}/default`, 'POST', { isDefault: true })}>
                      <Star size={14} />
                      {t('printDesigner.list.makeDefault')}
                    </button>
                  )}
                  <button className={btnSecondary} disabled={busy} onClick={() => call(`/print-templates/${tpl.id}/duplicate`, 'POST', {})}>
                    <Copy size={14} />
                    {t('printDesigner.list.duplicate')}
                  </button>
                  {multiBranch && (
                    <button className={btnSecondary} disabled={busy} onClick={() => copyToBranch(tpl)}>
                      <Copy size={14} />
                      {t('printDesigner.list.copyToBranch')}
                    </button>
                  )}
                  <button className={btnSecondary} disabled={busy} onClick={() => remove(tpl)} aria-label={t('common.delete')}>
                    <Trash2 size={14} className="text-red-600" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-gray-500">{t('printDesigner.list.footnote')}</p>
    </PageFrame>
  );
}
