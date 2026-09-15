import { Search, ArrowDownWideNarrow, Clock, X } from 'lucide-react';
import type { Topic, Mood, Importance } from '../lib/types';
import { TOPIC_ORDER, TOPIC } from '../lib/theme';

export interface Filters {
  topic: Topic | 'All';
  company: string | 'All';
  source: string | 'All';
  mood: Mood | 'All';
  importance: Importance | 'All';
  q: string;
  sort: 'newest' | 'important';
}

export const DEFAULT_FILTERS: Filters = {
  topic: 'All',
  company: 'All',
  source: 'All',
  mood: 'All',
  importance: 'All',
  q: '',
  sort: 'newest',
};

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-[7.5rem] cursor-pointer rounded-lg border-0 bg-white py-2 pl-3 pr-8 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterBar({
  filters,
  companies,
  sources,
  onChange,
  onReset,
}: {
  filters: Filters;
  companies: string[];
  sources: string[];
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
}) {
  const topicOpts = [
    { value: 'All', label: 'All topics' },
    ...TOPIC_ORDER.map((t) => ({ value: t, label: TOPIC[t].label })),
  ];
  const companyOpts = [
    { value: 'All', label: 'All companies' },
    ...companies.map((c) => ({ value: c, label: c })),
  ];
  const sourceOpts = [
    { value: 'All', label: 'All sources' },
    ...sources.map((s) => ({ value: s, label: s })),
  ];
  const moodOpts = [
    { value: 'All', label: 'All moods' },
    { value: 'positive', label: 'Good' },
    { value: 'neutral', label: 'Neutral' },
    { value: 'negative', label: 'Bad' },
  ];
  const impOpts = [
    { value: 'All', label: 'All' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ];

  const isDirty =
    filters.topic !== 'All' ||
    filters.company !== 'All' ||
    filters.source !== 'All' ||
    filters.mood !== 'All' ||
    filters.importance !== 'All' ||
    filters.q.trim() !== '';

  return (
    <div className="rounded-2xl bg-white/70 p-3 ring-1 ring-slate-200/70 backdrop-blur">
      <div className="flex flex-wrap items-end gap-3">
        {/* Search */}
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Search
          </span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={filters.q}
              onChange={(e) => onChange({ q: e.target.value })}
              placeholder="Search headlines, companies…"
              className="w-full rounded-lg border-0 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </label>

        <Select
          label="Topic"
          value={filters.topic}
          options={topicOpts}
          onChange={(v) => onChange({ topic: v as Filters['topic'] })}
        />
        <Select
          label="Company"
          value={filters.company}
          options={companyOpts}
          onChange={(v) => onChange({ company: v })}
        />
        <Select
          label="Source"
          value={filters.source}
          options={sourceOpts}
          onChange={(v) => onChange({ source: v })}
        />
        <Select
          label="Mood"
          value={filters.mood}
          options={moodOpts}
          onChange={(v) => onChange({ mood: v as Filters['mood'] })}
        />
        <Select
          label="Importance"
          value={filters.importance}
          options={impOpts}
          onChange={(v) => onChange({ importance: v as Filters['importance'] })}
        />

        {/* Sort toggle */}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Sort
          </span>
          <div className="inline-flex rounded-lg bg-slate-100 p-1 ring-1 ring-slate-200">
            <button
              onClick={() => onChange({ sort: 'newest' })}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold transition ${
                filters.sort === 'newest'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              Newest
            </button>
            <button
              onClick={() => onChange({ sort: 'important' })}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold transition ${
                filters.sort === 'important'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              Important
            </button>
          </div>
        </div>

        {isDirty && (
          <button
            onClick={onReset}
            className="mb-0.5 inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
