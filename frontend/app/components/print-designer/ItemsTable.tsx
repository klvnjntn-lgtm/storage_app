'use client';

import { forwardRef, type CSSProperties } from 'react';
import type { PrintRow } from '@/lib/print-designer/context';
import { FONT_STACK, type FontFamily, type TableColumn, type TableConfig } from '@/lib/print-designer/types';

const CELL_PAD_X = '1.2mm';
const HEADER_RULE = '0.35mm';
const RULE = '0.2mm';

// The items table on a page: the given rows under a header. The same
// component draws the hidden copy the pagination measures, so the measured
// heights match what prints.
export const ItemsTable = forwardRef<
  HTMLTableElement,
  {
    config: TableConfig;
    columns: TableColumn[];
    widths: number[];
    rows: (PrintRow | null)[];
    // Index of the first row, for zebra striping across pages.
    offset?: number;
    family: FontFamily;
  }
>(function ItemsTable({ config, columns, widths, rows, offset = 0, family }, ref) {
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const rule = `${RULE} solid ${config.borderColor || '#999999'}`;
  const headerRule = `${HEADER_RULE} solid ${config.borderColor || '#999999'}`;
  const grid = config.borders === 'grid';

  const cell = (align: string, extra: CSSProperties = {}): CSSProperties => ({
    padding: `${config.rowPadding}mm ${CELL_PAD_X}`,
    textAlign: align as CSSProperties['textAlign'],
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
    overflow: 'hidden',
    ...(grid && { border: rule }),
    ...extra,
  });

  return (
    <table
      ref={ref}
      style={{
        width: `${totalWidth}mm`,
        tableLayout: 'fixed',
        borderCollapse: 'collapse',
        fontFamily: FONT_STACK[family],
        color: '#000000',
        lineHeight: 1.25,
        ...(config.borders === 'outer' && { border: rule }),
      }}
    >
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: `${w}mm` }} />
        ))}
      </colgroup>
      <thead>
        <tr data-head="">
          {columns.map((c) => (
            <th
              key={c.key}
              style={cell(c.align, {
                fontSize: `${config.headerFontSize}pt`,
                fontWeight: config.headerBold ? 700 : 400,
                background: config.headerBg || 'transparent',
                color: config.headerColor || '#000000',
                ...(config.borders !== 'none' && config.borders !== 'grid' && { borderBottom: headerRule }),
              })}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={i}
            data-row=""
            style={{ background: config.zebra && (offset + i) % 2 === 1 ? config.zebra : 'transparent', breakInside: 'avoid' }}
          >
            {columns.map((c) => (
              <td
                key={c.key}
                style={cell(c.align, {
                  fontSize: `${config.fontSize}pt`,
                  ...(config.borders === 'rows' && { borderBottom: rule }),
                })}
              >
                {r ? r[c.key] : ' '}
                {r && c.key === 'name' && r.serials && (
                  <span style={{ display: 'block', fontSize: `${Math.max(5, config.fontSize - 1.5)}pt`, color: '#4b5563', fontFamily: FONT_STACK.mono }}>
                    {r.serials}
                  </span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
});
