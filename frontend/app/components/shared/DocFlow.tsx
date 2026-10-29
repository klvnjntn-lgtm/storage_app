'use client';

import Link from 'next/link';
import { ClipboardList, FileSignature, Receipt, Truck, Wrench, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';

// The documents a sale passes through: quotation → sales order / work order → delivery → invoice.
export type DocKind = 'quotation' | 'salesOrder' | 'delivery' | 'invoice' | 'workOrder';
export type DocRef = { kind: DocKind; id: string; number: string | null; status?: string | null };

const HREF: Record<DocKind, (id: string) => string> = {
  quotation: (id) => `/sales/quotations/${id}`,
  salesOrder: (id) => `/sales/orders/${id}`,
  delivery: (id) => `/sales/delivery-orders/${id}`,
  invoice: (id) => `/sales/invoices/${id}`,
  workOrder: (id) => `/workshop/work-orders/${id}`,
};

const ICON: Record<DocKind, LucideIcon> = {
  quotation: FileSignature,
  salesOrder: ClipboardList,
  delivery: Truck,
  invoice: Receipt,
  workOrder: Wrench,
};

// Voided / cancelled / declined documents stay listed (the history is real) but read as dead.
const DEAD = new Set(['VOID', 'CANCELLED', 'REJECTED']);

// Builds a ref, dropping a missing relation so callers can pass `row.quotation` straight in.
export function docRef(
  kind: DocKind,
  doc: { id: string; status?: string | null } | null | undefined,
  number: string | null | undefined,
): DocRef[] {
  return doc ? [{ kind, id: doc.id, number: number ?? null, status: doc.status ?? null }] : [];
}

// On a list row: where this document was converted from, and what it was converted to. Each chip
// opens that document; clicks don't reach the row's own link.
export function DocFlow({ from = [], to = [] }: { from?: DocRef[]; to?: DocRef[] }) {
  const { t } = useLanguage();
  if (from.length === 0 && to.length === 0) return null;

  const chip = (d: DocRef) => {
    const Icon = ICON[d.kind];
    const dead = !!d.status && DEAD.has(d.status);
    return (
      <Link
        key={`${d.kind}-${d.id}`}
        href={HREF[d.kind](d.id)}
        onClick={(e) => e.stopPropagation()}
        title={t(`common.docFlow.${d.kind}`)}
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium transition-colors ${
          dead
            ? 'border-gray-200 text-gray-400 line-through'
            : 'border-blue-500/20 bg-blue-50/60 text-blue-700 hover:border-blue-500/50 hover:bg-blue-50'
        }`}
      >
        <Icon size={11} strokeWidth={2} className="shrink-0" />
        {d.number ?? `${t(`common.docFlow.${d.kind}`)} · ${t('common.docFlow.draft')}`}
      </Link>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5 text-[11px]">
      {from.length > 0 && (
        <>
          <span className="text-gray-400">{t('common.docFlow.from')}</span>
          {from.map(chip)}
        </>
      )}
      {from.length > 0 && to.length > 0 && <span className="text-gray-300 px-0.5">·</span>}
      {to.length > 0 && (
        <>
          <span className="text-gray-400">{t('common.docFlow.to')}</span>
          {to.map(chip)}
        </>
      )}
    </div>
  );
}
