import { useMemo, useState } from 'react';
import { SearchX } from 'lucide-react';
import type { NewsItem } from '../lib/types';
import {
  FilterBar,
  DEFAULT_FILTERS,
  type Filters,
} from '../components/FilterBar';
import { NewsCard } from '../components/NewsCard';
import { EmptyState } from '../components/ui/EmptyState';

const IMP_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function Feed({ items }: { items: NewsItem[] }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const companies = useMemo(
    () => [...new Set(items.map((i) => i.company))].sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const sources = useMemo(
    () => [...new Set(items.map((i) => i.source))].sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const shown = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const out = items.filter((it) => {
      if (filters.topic !== 'All' && it.topic !== filters.topic) return false;
      if (filters.company !== 'All' && it.company !== filters.company) return false;
      if (filters.source !== 'All' && it.source !== filters.source) return false;
      if (filters.mood !== 'All' && it.mood !== filters.mood) return false;
      if (filters.importance !== 'All' && it.importance !== filters.importance)
        return false;
      if (
        q &&
        !`${it.title} ${it.company} ${it.takeaway} ${it.keyword} ${it.ticker}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
    out.sort((a, b) =>
      filters.sort === 'newest'
        ? b.date.localeCompare(a.date)
        : IMP_RANK[a.importance] - IMP_RANK[b.importance] ||
          b.date.localeCompare(a.date),
    );
    return out;
  }, [items, filters]);

  return (
    <div className="space-y-4">
      <FilterBar
        filters={filters}
        companies={companies}
        sources={sources}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onReset={() => setFilters(DEFAULT_FILTERS)}
      />

      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-slate-500">
          Showing{' '}
          <span className="font-bold tabular-nums text-slate-700">
            {shown.length}
          </span>{' '}
          {shown.length === 1 ? 'story' : 'stories'}
        </p>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No stories match these filters"
          hint="Try clearing a filter or searching for something else."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {shown.map((it) => (
            <NewsCard key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}
