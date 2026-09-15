import { BarChart3, Newspaper, FileText, type LucideIcon } from 'lucide-react';

export type TabKey = 'pulse' | 'feed' | 'filings';

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'pulse', label: 'Pulse', icon: BarChart3 },
  { key: 'feed', label: 'Feed', icon: Newspaper },
  { key: 'filings', label: 'Filings', icon: FileText },
];

export function Tabs({
  value,
  onChange,
}: {
  value: TabKey;
  onChange: (t: TabKey) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Section"
      className="inline-flex items-center gap-1 rounded-xl bg-white/70 p-1 ring-1 ring-slate-200/70 backdrop-blur"
    >
      {TABS.map((t) => {
        const active = value === t.key;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-bold transition-all ${
              active
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }`}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
