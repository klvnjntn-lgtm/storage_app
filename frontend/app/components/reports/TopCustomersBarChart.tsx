'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { formatIDRCompact, formatIDR } from '@/lib/format';
import { CHART_COLORS } from './types';
import type { TopCustomerRow } from './types';

// Magnitude ranking, one measure per customer — sequential (single hue),
// not categorical: these aren't distinct series, they're one series
// sorted low->high. Names live on the axis, so identity never depends on
// color. See dataviz skill: choosing-a-form.md "Compare magnitude" row.
const BAR_COLOR = CHART_COLORS[0];

function truncate(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export default function TopCustomersBarChart({
  rows,
  compact = false,
}: {
  rows: TopCustomerRow[];
  compact?: boolean;
}) {
  const nameMax = compact ? 14 : 22;
  const data = rows.map((r) => ({ ...r, shortName: truncate(r.name, nameMax) }));
  const height = compact ? Math.max(120, data.length * 28) : Math.max(220, data.length * 36);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: compact ? 8 : 56, bottom: 4, left: 4 }}
        barSize={compact ? 14 : 18}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="shortName"
          width={compact ? 90 : 140}
          tick={{ fontSize: compact ? 10 : 12, fill: '#52514e' }}
          tickLine={false}
          axisLine={false}
        />
        {!compact && (
          <Tooltip
            cursor={{ fill: 'rgba(37,99,235,0.06)' }}
            formatter={(value: unknown) => [formatIDR(Number(value)), 'Revenue']}
            labelFormatter={(_: unknown, payload: unknown) =>
              (payload as { payload?: TopCustomerRow }[] | undefined)?.[0]?.payload?.name ?? ''
            }
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e1e0d9' }}
          />
        )}
        <Bar dataKey="revenue" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((_, i) => (
            <Cell key={i} fill={BAR_COLOR} />
          ))}
          {!compact && (
            <LabelList
              dataKey="revenue"
              position="right"
              formatter={(value: unknown) => formatIDRCompact(Number(value))}
              style={{ fontSize: 11, fill: '#52514e' }}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
