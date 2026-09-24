'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatIDR } from '@/lib/format';
import { CHART_COLORS, CHART_OTHER_COLOR } from './types';
import type { TopProductRow } from './types';

// Part-to-whole (revenue share of top items) is the one legitimate pie
// use case, so this is the deliberate "pie chart" of the set — everything
// ranking a magnitude (customers, vehicles) stays a sequential bar per
// the dataviz skill. Capped at the series-count ladder's soft limit (5
// slices) with the remainder folded into "Other" (muted gray, not a 6th
// hue) rather than ever generating more categorical colors.
const MAX_SLICES_FULL = 5;
const MAX_SLICES_COMPACT = 4;
const DIRECT_LABEL_MIN_SHARE = 0.08;

export default function TopItemsPieChart({
  rows,
  compact = false,
  otherLabel = 'Other',
}: {
  rows: TopProductRow[];
  compact?: boolean;
  otherLabel?: string;
}) {
  const maxSlices = compact ? MAX_SLICES_COMPACT : MAX_SLICES_FULL;
  const sorted = [...rows].sort((a, b) => b.revenue - a.revenue);
  const head = sorted.slice(0, maxSlices);
  const tail = sorted.slice(maxSlices);
  const tailRevenue = tail.reduce((sum, r) => sum + r.revenue, 0);

  const slices = head.map((r, i) => ({
    name: r.name,
    revenue: r.revenue,
    unitsSold: r.unitsSold,
    fill: CHART_COLORS[i],
  }));
  if (tailRevenue > 0) {
    slices.push({ name: otherLabel, revenue: tailRevenue, unitsSold: 0, fill: CHART_OTHER_COLOR });
  }

  const total = slices.reduce((sum, s) => sum + s.revenue, 0) || 1;
  const size = compact ? 140 : 260;

  return (
    <ResponsiveContainer width="100%" height={compact ? 150 : 280}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="revenue"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={compact ? size * 0.22 : size * 0.24}
          outerRadius={compact ? size * 0.42 : size * 0.4}
          paddingAngle={2}
          cornerRadius={3}
          isAnimationActive={false}
          label={
            compact
              ? undefined
              : (props: unknown) => {
                  const revenue = Number((props as { revenue?: number }).revenue ?? 0);
                  return revenue / total >= DIRECT_LABEL_MIN_SHARE ? `${Math.round((revenue / total) * 100)}%` : '';
                }
          }
          labelLine={false}
        >
          {slices.map((s, i) => (
            <Cell key={i} fill={s.fill} stroke="#fcfcfb" strokeWidth={2} />
          ))}
        </Pie>
        {!compact && (
          <>
            <Tooltip
              formatter={(value: unknown, _name: unknown, entry: unknown) => {
                const payload = (entry as { payload?: (typeof slices)[number] } | undefined)?.payload;
                return [`${formatIDR(Number(value))} (${payload?.unitsSold ?? 0} sold)`, payload?.name];
              }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e1e0d9' }}
            />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, color: '#52514e' }}
            />
          </>
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}
