import { ExternalLink, Sparkles } from 'lucide-react';
import type { NewsItem } from '../../lib/types';
import { topHighlights } from '../../lib/metrics';
import { TOPIC, MOOD } from '../../lib/theme';
import { Pill } from '../ui/Pill';

function HighlightCard({ item }: { item: NewsItem }) {
  const topic = TOPIC[item.topic];
  const mood = MOOD[item.mood];
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70 transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <span
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: topic.hex }}
      />
      <div className="mb-1.5 mt-1 flex items-center gap-1.5">
        <Pill className={topic.pill}>{topic.label}</Pill>
        <span className={`h-2 w-2 rounded-full ${mood.dot}`} title={mood.label} />
        <ExternalLink className="ml-auto h-3.5 w-3.5 text-slate-300 group-hover:text-indigo-500" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-500">
          {item.company}
        </p>
        {item.sources_count && item.sources_count > 1 ? (
          <span
            className="shrink-0 text-[10px] font-semibold text-slate-400"
            title={`Reported by ${item.sources_count} sources`}
          >
            +{item.sources_count - 1}
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 line-clamp-3 text-xs font-semibold leading-snug text-slate-800 group-hover:text-indigo-600">
        {item.takeaway}
      </p>
    </a>
  );
}

export function HighlightsStrip({ items }: { items: NewsItem[] }) {
  const highlights = topHighlights(
    items.filter((i) => i.importance === 'high'),
    5,
  );
  if (highlights.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-bold text-slate-800">Today&apos;s highlights</h2>
        <span className="text-xs text-slate-400">
          the biggest stories right now
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {highlights.map((it) => (
          <HighlightCard key={it.id} item={it} />
        ))}
      </div>
    </section>
  );
}
