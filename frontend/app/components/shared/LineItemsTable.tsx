'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Plus, Search, Trash2, Wrench } from 'lucide-react';
import QtyInput from '@/app/components/shared/QtyInput';
import { formatIDR } from '@/lib/format';
import { useLanguage } from '@/app/context/LanguageContext';
import type { DiscountType } from '@/app/components/invoices/types';

const SEARCH_DEBOUNCE_MS = 250;

// One row of the table, already priced by the page — the table only shows it and reports edits.
export type TableLine = {
  key: string;
  kind: 'product' | 'service';
  // Product name, or the service's typed description.
  name: string;
  // Small print under a product's name (SKU, stock location).
  sub?: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  total: number;
  // A catalogue price the user can't type over (no POS pricing).
  priceLocked?: boolean;
  // Always one (a sales document's service line): shown, not editable.
  quantityFixed?: boolean;
  // Something wrong with the line, shown under it.
  warning?: string | null;
  // A product typed in rather than picked (a purchase order's new product): the name is an input,
  // and onChangeDescription edits it.
  typedName?: boolean;
  // Extra controls under the name, e.g. the price-level select.
  extra?: ReactNode;
};

// What the item search shows for one result.
// disabled: shown greyed out and can't be picked (e.g. out of stock where stock can't go negative).
export type SearchOption = { id: string; name: string; sku?: string | null; meta?: string | null; disabled?: boolean };

type LineHandlers = {
  onChangeQty: (key: string, qty: number) => void;
  onChangePrice?: (key: string, raw: string) => void;
  onChangeDescription?: (key: string, value: string) => void;
  onChangeUnit?: (key: string, value: string) => void;
  onChangeDiscount?: (key: string, discountType: DiscountType | null, rawValue?: string) => void;
  onRemove: (key: string) => void;
};

// Desktop cells: gridlines between every cell, and the inputs fill their cell like a spreadsheet's.
const th = 'px-2.5 py-2 border-b border-r border-gray-200 last:border-r-0 font-semibold';
const td = 'border-b border-r border-gray-200 last:border-r-0 align-top p-0';
const cellEdit =
  'w-full h-10 px-2.5 text-sm bg-transparent outline-none focus:bg-blue-50/50 focus:ring-2 focus:ring-inset focus:ring-blue-500/40';
const cellText = 'block h-10 leading-10 px-2.5 text-sm';
// Phones: each line is a card of labelled fields.
const cardInput =
  'w-full h-9 border border-gray-300 rounded-md px-2 text-sm bg-white outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20';

// Accurate-style document lines: a table of the products and services on the document, with a last,
// always-empty row whose search adds the next product, and an "Add service" button for typed lines.
export function LineItemsTable<T>({
  lines,
  search,
  describe,
  onPick,
  onAddService,
  totals,
  footer,
  bare,
  hideUnit,
  priceLabel,
  addServiceLabel,
  ...handlers
}: LineHandlers & {
  lines: TableLine[];
  // Item search for the empty row; the page decides the endpoint and how a pick becomes a line.
  search: (q: string) => Promise<T[]>;
  describe: (result: T) => SearchOption;
  onPick: (result: T) => void;
  // Left out: product lines only.
  onAddService?: () => void;
  // The document's subtotal / discount / total, shown under the lines.
  totals?: { subtotal: number; discount: number; total: number };
  // Under the lines, e.g. the bulk-discount bar.
  footer?: ReactNode;
  // Inside a card the page draws: no border of its own.
  bare?: boolean;
  // No Unit column (purchase orders' lines carry none).
  hideUnit?: boolean;
  // The Price column's heading, e.g. "Unit cost" on a purchase order.
  priceLabel?: string;
  // The add-a-typed-line button's text, e.g. "Add new product" on a purchase order.
  addServiceLabel?: string;
}) {
  const { t } = useLanguage();
  // Left out (onChangeDiscount): no discount column, e.g. purchase orders.
  const showDiscount = !!handlers.onChangeDiscount;
  const showUnit = !hideUnit;
  // Columns before Total, which the totals rows' labels span.
  const labelSpan = 4 + (showDiscount ? 1 : 0) + (showUnit ? 1 : 0);

  const addService = onAddService && (
    <button
      type="button"
      onClick={onAddService}
      className="shrink-0 h-10 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 rounded-lg border border-gray-300 bg-white text-gray-700 hover:border-blue-500/50 hover:bg-blue-50/50"
    >
      <Plus size={13} strokeWidth={2} />
      {addServiceLabel ?? t('common.lineTable.addService')}
    </button>
  );

  return (
    <div
      data-tour="sales-lines"
      className={bare ? '' : 'border border-gray-200 rounded-xl bg-white shadow-sm overflow-visible'}
    >
      {/* Desktop: a real table. */}
      <table className="hidden md:table w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-11" />
          <col />
          <col className="w-20" />
          {showUnit && <col className="w-24" />}
          <col className="w-36" />
          {showDiscount && <col className="w-36" />}
          <col className="w-36" />
          <col className="w-11" />
        </colgroup>
        <thead>
          <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <th className={`${th} text-center ${bare ? '' : 'rounded-tl-xl'}`}>{t('common.lineTable.no')}</th>
            <th className={`${th} text-left`}>{t('common.lineTable.item')}</th>
            <th className={`${th} text-right`}>{t('common.lineTable.qty')}</th>
            {showUnit && <th className={`${th} text-left`}>{t('common.lineTable.unit')}</th>}
            <th className={`${th} text-right`}>{priceLabel ?? t('common.lineTable.price')}</th>
            {showDiscount && <th className={`${th} text-left`}>{t('common.lineTable.discount')}</th>}
            <th className={`${th} text-right`}>{t('common.lineTable.total')}</th>
            <th className={`${th} ${bare ? '' : 'rounded-tr-xl'}`}>
              <span className="sr-only">{t('common.lineTable.remove')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td colSpan={labelSpan + 2} className={`${td} px-3 py-4 text-gray-400`}>
                {t('common.lineTable.empty')}
              </td>
            </tr>
          )}
          {lines.map((line, i) => (
            <TableRow key={line.key} index={i + 1} line={line} showDiscount={showDiscount} showUnit={showUnit} {...handlers} />
          ))}
          <tr className="bg-blue-50/30">
            <td className={`${td} text-center align-middle text-blue-600`}>
              <Plus size={14} strokeWidth={2.25} className="inline" />
            </td>
            <td colSpan={labelSpan + 1} className={`${td} px-2 py-2`}>
              <div className="flex items-center gap-2">
                <RowSearch search={search} describe={describe} onPick={onPick} />
                {addService}
              </div>
            </td>
          </tr>
        </tbody>
        {totals && (
          <tfoot>
            <TotalRow label={t('common.subtotal')} value={formatIDR(totals.subtotal)} span={labelSpan} />
            {totals.discount > 0 && (
              <TotalRow
                label={t('common.lineTable.discount')}
                value={`−${formatIDR(totals.discount)}`}
                span={labelSpan}
              />
            )}
            <TotalRow label={t('common.total')} value={formatIDR(totals.total)} span={labelSpan} strong />
          </tfoot>
        )}
      </table>

      {/* Phones: a card per line. */}
      <div className="md:hidden">
        {lines.length === 0 && <p className="px-3 py-4 text-sm text-gray-400">{t('common.lineTable.empty')}</p>}
        <div className="divide-y divide-gray-200 border-b border-gray-200">
          {lines.map((line, i) => (
            <CardRow
              key={line.key}
              index={i + 1}
              line={line}
              showDiscount={showDiscount}
              showUnit={showUnit}
              priceLabel={priceLabel}
              {...handlers}
            />
          ))}
        </div>
        <div className="p-3 flex flex-col gap-2 bg-blue-50/30">
          <RowSearch search={search} describe={describe} onPick={onPick} />
          {addService}
        </div>
        {totals && (
          <dl className="px-3 py-3 border-t border-gray-200 space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <dt>{t('common.subtotal')}</dt>
              <dd className="tabular-nums">{formatIDR(totals.subtotal)}</dd>
            </div>
            {totals.discount > 0 && (
              <div className="flex justify-between text-gray-600">
                <dt>{t('common.lineTable.discount')}</dt>
                <dd className="tabular-nums">−{formatIDR(totals.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between font-bold pt-1 border-t border-gray-200">
              <dt>{t('common.total')}</dt>
              <dd className="tabular-nums">{formatIDR(totals.total)}</dd>
            </div>
          </dl>
        )}
      </div>

      {footer && <div className="px-3 py-2 border-t border-gray-200">{footer}</div>}
    </div>
  );
}

function TotalRow({ label, value, span, strong }: { label: string; value: string; span: number; strong?: boolean }) {
  return (
    <tr className={strong ? 'font-bold' : 'text-gray-600'}>
      <td colSpan={span} className="px-2.5 py-1.5 text-right">
        {label}
      </td>
      <td className={`px-2.5 py-1.5 text-right tabular-nums ${strong ? 'border-t-2 border-gray-300' : ''}`}>
        {value}
      </td>
      <td />
    </tr>
  );
}

function NameCell({ line, onChangeDescription, boxed }: { line: TableLine; onChangeDescription?: LineHandlers['onChangeDescription']; boxed?: boolean }) {
  const { t } = useLanguage();
  const isService = line.kind === 'service';
  return (
    <div className="min-w-0">
      {(isService || line.typedName) && onChangeDescription ? (
        <div className={`flex items-center ${boxed ? 'gap-2' : 'pl-2.5'}`}>
          {isService && <Wrench size={13} strokeWidth={2} className="text-blue-600/70 shrink-0" />}
          <input
            value={line.name}
            onChange={(e) => onChangeDescription(line.key, e.target.value)}
            placeholder={isService ? t('common.lineTable.servicePlaceholder') : t('common.lineTable.productNamePlaceholder')}
            aria-invalid={!line.name.trim()}
            className={`${boxed ? cardInput : `${cellEdit} pl-2`} ${!line.name.trim() ? 'placeholder:text-amber-600' : ''}`}
          />
        </div>
      ) : (
        <p className={boxed ? 'text-sm font-medium break-words' : 'px-2.5 pt-2.5 text-sm leading-snug break-words'}>
          {line.name}
        </p>
      )}
      {(line.sub || line.extra || line.warning) && (
        <div className={boxed ? 'mt-0.5' : 'px-2.5 pb-2'}>
          {line.sub && <p className="text-[11px] text-gray-400 truncate">{line.sub}</p>}
          {line.extra && <div className="mt-1">{line.extra}</div>}
          {line.warning && (
            <p className="flex items-center gap-1 text-[11px] text-red-600 mt-1">
              <AlertCircle size={11} strokeWidth={2} className="shrink-0" />
              {line.warning}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DiscountInputs({
  line,
  onChangeDiscount,
  boxed,
}: {
  line: TableLine;
  onChangeDiscount: NonNullable<LineHandlers['onChangeDiscount']>;
  boxed?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className={`flex ${boxed ? 'gap-1' : 'h-10 divide-x divide-gray-200'}`}>
      <select
        value={line.discountType ?? ''}
        aria-label={t('common.lineTable.discount')}
        onChange={(e) => {
          const next = (e.target.value || null) as DiscountType | null;
          onChangeDiscount(line.key, next, next ? String(line.discountValue ?? 0) : undefined);
        }}
        className={boxed ? `${cardInput} w-16 px-1` : `${cellEdit} w-14 shrink-0 px-1.5 text-xs`}
      >
        <option value="">—</option>
        <option value="PERCENTAGE">%</option>
        <option value="FIXED">Rp</option>
      </select>
      {line.discountType && (
        <input
          type="number"
          min={0}
          value={line.discountValue ?? ''}
          aria-label={t('common.lineTable.discount')}
          onChange={(e) => onChangeDiscount(line.key, line.discountType, e.target.value)}
          className={`${boxed ? cardInput : cellEdit} text-right tabular-nums min-w-0`}
        />
      )}
    </div>
  );
}

function PriceInput({ line, onChangePrice, boxed }: { line: TableLine; onChangePrice?: LineHandlers['onChangePrice']; boxed?: boolean }) {
  const { t } = useLanguage();
  if (line.priceLocked || !onChangePrice) {
    return (
      <span className={`${boxed ? 'block h-9 leading-9 text-sm' : cellText} text-right tabular-nums text-gray-700`}>
        {line.unitPrice != null ? formatIDR(line.unitPrice) : '—'}
      </span>
    );
  }
  const missing = line.unitPrice === null;
  return (
    <input
      type="number"
      min={0}
      inputMode="decimal"
      value={line.unitPrice ?? ''}
      placeholder="0"
      title={missing ? t('common.lineTable.priceRequired') : undefined}
      onChange={(e) => onChangePrice(line.key, e.target.value)}
      aria-invalid={missing}
      className={`${boxed ? cardInput : cellEdit} text-right tabular-nums ${
        missing ? (boxed ? '!border-red-400' : 'bg-red-50/60') : ''
      }`}
    />
  );
}

function RemoveButton({ line, onRemove }: { line: TableLine; onRemove: LineHandlers['onRemove'] }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={() => onRemove(line.key)}
      aria-label={t('common.lineTable.remove')}
      title={t('common.lineTable.remove')}
      className="w-8 h-8 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
    >
      <Trash2 size={14} strokeWidth={2} />
    </button>
  );
}

function TableRow({
  index,
  line,
  showDiscount,
  onChangeQty,
  onChangePrice,
  onChangeDescription,
  onChangeUnit,
  onChangeDiscount,
  onRemove,
  showUnit,
}: LineHandlers & { index: number; line: TableLine; showDiscount: boolean; showUnit: boolean }) {
  const { t } = useLanguage();
  const isService = line.kind === 'service';
  return (
    <tr className="hover:bg-gray-50/70">
      <td className={`${td} text-center text-xs text-gray-400 leading-10`}>{index}</td>
      <td className={td}>
        <NameCell line={line} onChangeDescription={onChangeDescription} />
      </td>
      <td className={td}>
        {line.quantityFixed ? (
          <span className={`${cellText} text-right text-gray-500`}>1</span>
        ) : (
          <div className="flex h-10 items-center justify-end pr-1">
            <QtyInput value={Number(line.quantity)} onCommit={(q) => onChangeQty(line.key, q)} aria-label={t('common.lineTable.qty')} />
          </div>
        )}
      </td>
      {showUnit && (
        <td className={td}>
          {isService && onChangeUnit ? (
            <input
              value={line.unit ?? ''}
              onChange={(e) => onChangeUnit(line.key, e.target.value)}
              aria-label={t('common.lineTable.unit')}
              className={cellEdit}
            />
          ) : (
            <span className={`${cellText} truncate text-gray-600`}>{line.unit ?? '—'}</span>
          )}
        </td>
      )}
      <td className={td}>
        <PriceInput line={line} onChangePrice={onChangePrice} />
      </td>
      {showDiscount && onChangeDiscount && (
        <td className={td}>
          <DiscountInputs line={line} onChangeDiscount={onChangeDiscount} />
        </td>
      )}
      <td className={td}>
        <span className={`${cellText} text-right font-semibold tabular-nums`}>{formatIDR(line.total)}</span>
        {line.discountAmount > 0 && (
          <span className="block px-2.5 -mt-2.5 pb-1 text-right text-[11px] text-gray-400 tabular-nums">
            −{formatIDR(line.discountAmount)}
          </span>
        )}
      </td>
      <td className={`${td} text-center pt-1`}>
        <RemoveButton line={line} onRemove={onRemove} />
      </td>
    </tr>
  );
}

function CardRow({
  index,
  line,
  showDiscount,
  onChangeQty,
  onChangePrice,
  onChangeDescription,
  onChangeUnit,
  onChangeDiscount,
  onRemove,
  showUnit,
  priceLabel,
}: LineHandlers & { index: number; line: TableLine; showDiscount: boolean; showUnit: boolean; priceLabel?: string }) {
  const { t } = useLanguage();
  const isService = line.kind === 'service';
  const label = 'text-[11px] text-gray-400 mb-0.5 block';
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="text-xs text-gray-400 pt-0.5 w-5 shrink-0">{index}</span>
        <div className="flex-1 min-w-0">
          <NameCell line={line} onChangeDescription={onChangeDescription} boxed />
        </div>
        <RemoveButton line={line} onRemove={onRemove} />
      </div>
      <div className="grid grid-cols-3 gap-2 pl-7">
        <label>
          <span className={label}>{t('common.lineTable.qty')}</span>
          {line.quantityFixed ? (
            <span className="block h-9 leading-9 text-sm text-gray-500">1</span>
          ) : (
            <span className="flex h-9 items-center border border-gray-300 rounded-md bg-white">
              <QtyInput value={Number(line.quantity)} onCommit={(q) => onChangeQty(line.key, q)} aria-label={t('common.lineTable.qty')} />
            </span>
          )}
        </label>
        {showUnit && (
          <label>
            <span className={label}>{t('common.lineTable.unit')}</span>
            {isService && onChangeUnit ? (
              <input value={line.unit ?? ''} onChange={(e) => onChangeUnit(line.key, e.target.value)} className={cardInput} />
            ) : (
              <span className="block h-9 leading-9 text-sm text-gray-600 truncate">{line.unit ?? '—'}</span>
            )}
          </label>
        )}
        <label>
          <span className={label}>{priceLabel ?? t('common.lineTable.price')}</span>
          <PriceInput line={line} onChangePrice={onChangePrice} boxed />
        </label>
        {showDiscount && onChangeDiscount && (
          <div className="col-span-2">
            <span className={label}>{t('common.lineTable.discount')}</span>
            <DiscountInputs line={line} onChangeDiscount={onChangeDiscount} boxed />
          </div>
        )}
        <div className={`text-right ${showDiscount ? '' : 'col-span-3'}`}>
          <span className={label}>{t('common.lineTable.total')}</span>
          <span className="block h-9 leading-9 text-sm font-semibold tabular-nums">{formatIDR(line.total)}</span>
        </div>
      </div>
    </div>
  );
}

// The empty last row's item search: type, arrow through the results, Enter (or click) adds one and
// clears the box for the next — the way an Accurate entry grid works.
function RowSearch<T>({
  search,
  describe,
  onPick,
}: {
  search: (q: string) => Promise<T[]>;
  describe: (result: T) => SearchOption;
  onPick: (result: T) => void;
}) {
  const { t } = useLanguage();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const list = await search(query);
        if (mine !== seq.current) return;
        setResults(list.slice(0, 20));
        setActive(0);
        setOpen(true);
      } catch {
        // leave the previous results
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function pick(result: T) {
    onPick(result);
    seq.current++;
    setQ('');
    setResults([]);
    setOpen(false);
    setSearching(false);
    inputRef.current?.focus();
  }

  return (
    <div className="relative flex-1 min-w-0">
      {/* Where every new line starts, so it stands out: a blue-bordered box, not a bare cell. */}
      <div className="flex items-center gap-2 h-10 px-3 rounded-lg bg-white border-2 border-blue-500/50 shadow-sm hover:border-blue-500/70 focus-within:border-blue-600 focus-within:ring-4 focus-within:ring-blue-500/15 transition-colors">
        <Search size={16} strokeWidth={2.25} className="text-blue-600 shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value.trim()) {
              seq.current++;
              setResults([]);
              setOpen(false);
              setSearching(false);
            }
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && open && results[active]) {
              e.preventDefault();
              if (!describe(results[active]).disabled) pick(results[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={t('common.lineTable.searchItem')}
          aria-label={t('common.lineTable.searchItem')}
          className="flex-1 min-w-0 text-sm outline-none bg-transparent placeholder:text-gray-500"
        />
        {searching && <span className="text-[11px] text-gray-400 shrink-0">{t('common.lineTable.searching')}</span>}
      </div>
      {open && q.trim() && (
        <ul className="absolute z-30 left-0 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-blue-500/20 rounded-lg shadow-lg">
          {results.length === 0 && !searching && (
            <li className="px-3 py-2 text-sm text-gray-400">{t('common.lineTable.noResults')}</li>
          )}
          {results.map((r, i) => {
            const d = describe(r);
            return (
              <li key={d.id}>
                <button
                  type="button"
                  disabled={d.disabled}
                  aria-disabled={d.disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(r)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-baseline justify-between gap-3 ${
                    d.disabled ? 'text-gray-400 cursor-not-allowed' : i === active ? 'bg-blue-50' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="font-medium">{d.name}</span>
                    {d.sku && <span className="ml-2 text-xs text-gray-500">{d.sku}</span>}
                  </span>
                  {d.meta && (
                    <span className={`text-xs shrink-0 ${d.disabled ? 'text-red-400' : 'text-gray-500'}`}>{d.meta}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
