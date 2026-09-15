import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { NewsItem } from '../../lib/types';
import { moodCounts } from '../../lib/metrics';
import { MOOD } from '../../lib/theme';
import { GlassCard, Swatch, type RTooltipProps } from './tooltip';

function MoodTooltip({
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
        <span className="font-semibold">{p.payload.label} news</span>
      </div>
      <div className="mt-0.5 text-slate-300 tabular-nums">
        {p.value} stories · {pct}%
      </div>
    </GlassCard>
  );
}

export function MoodChart({ items }: { items: NewsItem[] }) {
  const data = moodCounts(items)
    .filter((d) => d.count > 0)
    .map((d) => ({
      ...d,
      label: MOOD[d.mood].label,
      hex: MOOD[d.mood].hex,
    }));
  const total = data.reduce((s, d) => s + d.count, 0);
  const positive = data.find((d) => d.mood === 'positive')?.count ?? 0;
  const goodPct = total ? Math.round((positive / total) * 100) : 0;

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
                <Cell key={d.mood} fill={d.hex} />
              ))}
            </Pie>
            <Tooltip content={<MoodTooltip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-extrabold tabular-nums text-emerald-600">
            {goodPct}%
          </div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            good news
          </div>
        </div>
      </div>

      <ul className="grid w-1/2 gap-2">
        {data.map((d) => (
          <li key={d.mood} className="flex items-center gap-2 text-xs">
            <Swatch color={d.hex} />
            <span className="text-slate-600">{d.label}</span>
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
