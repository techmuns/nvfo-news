import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { NewsItem } from '../../lib/types';
import { companyCounts } from '../../lib/metrics';
import { CHART_PALETTE } from '../../lib/theme';
import { GlassCard, Swatch, type RTooltipProps } from './tooltip';

function CompanyTooltip({ active, payload }: RTooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <GlassCard>
      <div className="flex items-center gap-2">
        <Swatch color={p.payload.fill} />
        <span className="font-semibold">{p.payload.company}</span>
      </div>
      <div className="mt-0.5 text-slate-300 tabular-nums">
        {p.value} stories
      </div>
    </GlassCard>
  );
}

function YTick({ x, y, payload }: any) {
  // Full company name, no truncation — the axis is widened to fit.
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="#475569">
      {String(payload.value)}
    </text>
  );
}

export function TopCompaniesBar({ items }: { items: NewsItem[] }) {
  const data = companyCounts(items, 8).map((d, i) => ({
    ...d,
    fill: CHART_PALETTE[i % CHART_PALETTE.length],
  }));

  // Size the label gutter to the longest name so nothing is clipped.
  const longest = data.reduce((m, d) => Math.max(m, d.company.length), 0);
  const labelWidth = Math.min(230, Math.max(120, Math.round(longest * 6.6 + 12)));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
        barCategoryGap={7}
      >
        <XAxis type="number" hide domain={[0, 'dataMax + 1']} />
        <YAxis
          type="category"
          dataKey="company"
          width={labelWidth}
          tickLine={false}
          axisLine={false}
          interval={0}
          tick={<YTick />}
        />
        <Tooltip
          cursor={{ fill: 'rgba(99,102,241,0.06)' }}
          content={<CompanyTooltip />}
        />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={16}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            fill="#64748b"
            fontSize={11}
            fontWeight={600}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
