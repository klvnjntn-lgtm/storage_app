'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { formatIDRCompact, formatIDR } from '@/lib/format';
import { CHART_COLORS } from './types';
import type { TopVehicleRow } from './types';

// Same sequential-magnitude treatment as TopCustomersBarChart — cars
// ranked by revenue, one hue, identity carried by the plate/model label.
const BAR_COLOR = CHART_COLORS[0];

export default function TopVehiclesBarChart({
  rows,
  compact = false,
}: {
  rows: TopVehicleRow[];
  compact?: boolean;
}) {
  const data = rows.map((r) => ({
    ...r,
    label: compact ? r.plateNumber : `${r.plateNumber} · ${r.vehicleModel}`,
  }));
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
          dataKey="label"
          width={compact ? 70 : 150}
          tick={{ fontSize: compact ? 10 : 12, fill: '#52514e' }}
          tickLine={false}
          axisLine={false}
        />
        {!compact && (
          <Tooltip
            cursor={{ fill: 'rgba(37,99,235,0.06)' }}
            formatter={(value: unknown) => [formatIDR(Number(value)), 'Revenue']}
            labelFormatter={(_: unknown, payload: unknown) => {
              const row = (payload as { payload?: (typeof data)[number] }[] | undefined)?.[0]?.payload;
              return row ? `${row.plateNumber} · ${row.vehicleModel}${row.customerName ? ` — ${row.customerName}` : ''}` : '';
            }}
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
