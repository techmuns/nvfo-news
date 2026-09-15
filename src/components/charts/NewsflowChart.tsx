import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { NewsItem } from '../../lib/types';
import { dailyCounts, maxDay, istToday } from '../../lib/metrics';
import { GlassCard, Swatch, type RTooltipProps } from './tooltip';

function TimelineTooltip({ active, payload, label }: RTooltipProps) {
  if (!active || !payload?.length) return null;
  const count = payload[0].value as number;
  return (
    <GlassCard>
      <div className="mb-1 font-semibold">{label}</div>
      <div className="flex items-center gap-2">
        <Swatch color="#6366f1" />
        <span className="text-slate-300">Stories</span>
        <span className="ml-3 font-semibold tabular-nums">{count}</span>
      </div>
    </GlassCard>
  );
}

export function NewsflowChart({ items }: { items: NewsItem[] }) {
  // End the 14-day window at today (IST) so recent zero-story days are shown
  // honestly. If the data somehow runs ahead of "today", extend to that.
  const latest = maxDay(items);
  const today = istToday();
  const end = latest > today ? latest : today;
  const data = dailyCounts(items, 14, end);
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="nf-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
            <stop offset="55%" stopColor="#a855f7" stopOpacity={0.14} />
            <stop offset="100%" stopColor="#ec4899" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={28}
          padding={{ left: 12, right: 8 }}
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          dy={4}
        />
        <YAxis hide domain={[0, 'dataMax + 1']} />
        <Tooltip
          content={<TimelineTooltip />}
          cursor={{ stroke: '#c7d2fe', strokeWidth: 1.5 }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#6366f1"
          strokeWidth={2.5}
          fill="url(#nf-area)"
          dot={false}
          activeDot={{ r: 4, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
