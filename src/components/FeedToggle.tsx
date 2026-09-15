import { Briefcase, Eye, Globe2, type LucideIcon } from 'lucide-react';
import type { FeedKey } from '../lib/types';

const FEEDS: { key: FeedKey; label: string; icon: LucideIcon }[] = [
  { key: 'portfolio', label: 'Portfolio', icon: Briefcase },
  { key: 'watchlist', label: 'Watchlist', icon: Eye },
  { key: 'universe', label: 'Universe', icon: Globe2 },
];

export function FeedToggle({
  value,
  counts,
  onChange,
}: {
  value: FeedKey;
  counts: Record<FeedKey, number>;
  onChange: (f: FeedKey) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="News feed"
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 p-1 ring-1 ring-slate-200"
    >
      {FEEDS.map((f) => {
        const active = value === f.key;
        const Icon = f.icon;
        return (
          <button
            key={f.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(f.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all ${
              active
                ? 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{f.label}</span>
            <span
              className={`ml-0.5 rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
                active ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-500'
              }`}
            >
              {counts[f.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
