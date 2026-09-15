import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { NewsItem } from '../../lib/types';
import { topicCounts } from '../../lib/metrics';
import { TOPIC } from '../../lib/theme';
import { GlassCard, Swatch, type RTooltipProps } from './tooltip';

function DonutTooltip({
  active,
  payload,
  total,
}: RTooltipProps & { total: number }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const pct = total ? Math.round((p.value / total) * 100) : 0;
  return (
    <GlassCard>
      <div className="flex items-center gap-2">
        <Swatch color={p.payload.hex} />
        <span className="font-semibold">{p.payload.label}</span>
      </div>
      <div className="mt-0.5 text-slate-300 tabular-nums">
        {p.value} stories · {pct}%
      </div>
    </GlassCard>
  );
}

export function TopicDonut({ items }: { items: NewsItem[] }) {
  const data = topicCounts(items).map((d) => ({
    ...d,
    label: TOPIC[d.topic].label,
    hex: TOPIC[d.topic].hex,
  }));
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[190px] w-1/2 min-w-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              innerRadius={50}
              outerRadius={78}
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.topic} fill={d.hex} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-extrabold tabular-nums text-slate-800">
            {total}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            stories
          </div>
        </div>
      </div>

      <ul className="grid w-1/2 gap-1.5">
        {data.map((d) => (
          <li key={d.topic} className="flex items-center gap-2 text-xs">
            <Swatch color={d.hex} />
            <span className="truncate text-slate-600">{d.label}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-800">
              {d.count}
            </span>
            <span className="w-9 text-right tabular-nums text-slate-400">
              {total ? Math.round((d.count / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
