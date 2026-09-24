'use client';

import { BarChart, Bar, XAxis, Cell, LabelList, ResponsiveContainer, Tooltip } from 'recharts';
import { formatIDRCompact } from '@/lib/format';

// Small multiples of a signed delta against a zero baseline (cash flow's
// operating/investing/financing legs) — per the dataviz skill: "Above/
// below a baseline -> diverging bar", colored by sign (good/critical
// status hexes), not the categorical palette — these are the same
// measure's sign, not distinct identities.
const POSITIVE = '#0ca30c';
const NEGATIVE = '#d03b3b';

export default function MiniDeltaBars({ items }: { items: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={90}>
      <BarChart data={items} margin={{ top: 16, right: 4, bottom: 0, left: 4 }} barCategoryGap="30%">
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={{ stroke: '#e1e0d9' }}
          tick={{ fontSize: 10, fill: '#898781' }}
        />
        <Tooltip
          cursor={{ fill: 'rgba(37,99,235,0.06)' }}
          formatter={(value: unknown) => [formatIDRCompact(Number(value)), '']}
          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e1e0d9' }}
        />
        <Bar dataKey="value" radius={[3, 3, 3, 3]} isAnimationActive={false}>
          {items.map((item, i) => (
            <Cell key={i} fill={item.value >= 0 ? POSITIVE : NEGATIVE} />
          ))}
          <LabelList
            dataKey="value"
            position="top"
            formatter={(value: unknown) => formatIDRCompact(Number(value))}
            style={{ fontSize: 10, fill: '#52514e' }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
