import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { Company, FeedKey, NewsItem, Scope } from './lib/types';
import { loadAll, type AppData } from './lib/data';
import {
  getCustomKeywords,
  setCustomKeywords,
  getCustomWatchlist,
  setCustomWatchlist,
  getRemovedTickers,
  setRemovedTickers,
} from './lib/storage';
import {
  loadCustom,
  addKeywordRemote,
  removeKeywordRemote,
  addStockRemote,
  removeStockRemote,
  addRemovedRemote,
  removeRemovedRemote,
  requestRefresh,
} from './lib/api';
import { TopBar } from './components/TopBar';
import { Tabs, type TabKey } from './components/Tabs';
import { AddPanel } from './components/AddPanel';
import { SubscribePanel } from './components/SubscribePanel';
import { SourcesPanel } from './components/SourcesPanel';
import { Pulse } from './pages/Pulse';
import { Feed } from './pages/Feed';
import { Filings } from './pages/Filings';

const FEED_DESC: Record<FeedKey, string> = {
  top5: 'Your 5 biggest holdings by family weight',
  portfolio: 'Your current holdings',
  watchlist: 'Holdings, exited names & anything you add',
  universe: 'Keyword-led discovery beyond your companies',
};

function scopeCount(items: NewsItem[], key: Scope): number {
  return items.filter((i) => i.scope.includes(key)).length;
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [feed, setFeed] = useState<FeedKey>('portfolio');
  const [tab, setTab] = useState<TabKey>('pulse');
  const [addOpen, setAddOpen] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [refreshCooling, setRefreshCooling] = useState(false);

  const [customKeywords, setCustomKeywordsState] = useState<string[]>(() =>
    getCustomKeywords(),
  );
  const [customWatchlist, setCustomWatchlistState] = useState<Company[]>(() =>
    getCustomWatchlist(),
  );
  const [removedTickers, setRemovedTickersState] = useState<string[]>(() =>
    getRemovedTickers(),
  );

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const d = await loadAll();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Refresh button: reload the latest committed data (as before) AND ask the
  // Worker to dispatch a fresh scrape. Degrades silently when the dispatch
  // isn't configured — the data reload still happens.
  const handleRefresh = useCallback(async () => {
    await fetchData(true);
    const r = await requestRefresh();
    if (r.ok) {
      setRefreshNote('Refreshing — new stories appear in ~5 minutes.');
      setRefreshCooling(true);
      window.setTimeout(() => setRefreshCooling(false), 8000);
      window.setTimeout(() => setRefreshNote(null), 12000);
    } else if (r.reason === 'cooldown') {
      const mins = Math.max(1, Math.ceil((r.retryInSec ?? 300) / 60));
      setRefreshNote(`Just refreshed — new stories are on the way. Try again in ~${mins} min.`);
      window.setTimeout(() => setRefreshNote(null), 6000);
    }
  }, [fetchData]);

  // Load custom keywords / stocks from the Worker KV (falls back to the
  // localStorage cache inside loadCustom if the API isn't reachable).
  useEffect(() => {
    void loadCustom().then(({ keywords, stocks, removed }) => {
      setCustomKeywordsState(keywords);
      setCustomWatchlistState(stocks);
      setRemovedTickersState(removed);
    });
  }, []);

  /* ---- customisation handlers: state + localStorage cache + KV (best-effort) ---- */
  const addKeywords = useCallback(
    (words: string[]) => {
      const base = new Set((data?.keywords.base ?? []).map((w) => w.toLowerCase()));
      const seen = new Set(customKeywords.map((w) => w.toLowerCase()));
      const toAdd: string[] = [];
      for (const w of words) {
        const lw = w.toLowerCase();
        if (!seen.has(lw) && !base.has(lw)) {
          toAdd.push(w);
          seen.add(lw);
        }
      }
      if (toAdd.length === 0) return;
      const next = [...customKeywords, ...toAdd];
      setCustomKeywordsState(next);
      setCustomKeywords(next);
      toAdd.forEach((w) => void addKeywordRemote(w));
    },
    [data, customKeywords],
  );

  const removeKeyword = useCallback(
    (kw: string) => {
      const next = customKeywords.filter((w) => w !== kw);
      setCustomKeywordsState(next);
      setCustomKeywords(next);
      void removeKeywordRemote(kw);
    },
    [customKeywords],
  );

  const removedSet = useMemo(
    () => new Set(removedTickers.map((t) => t.toUpperCase())),
    [removedTickers],
  );

  const restoreCompany = useCallback(
    (ticker: string) => {
      const up = ticker.toUpperCase();
      const next = removedTickers.filter((t) => t.toUpperCase() !== up);
      if (next.length === removedTickers.length) return;
      setRemovedTickersState(next);
      setRemovedTickers(next);
      void removeRemovedRemote(ticker);
    },
    [removedTickers],
  );

  const addCompany = useCallback(
    (c: Company) => {
      // Re-adding a company you'd removed simply un-hides it again.
      if (removedSet.has(c.ticker.toUpperCase())) {
        restoreCompany(c.ticker);
        return;
      }
      if (customWatchlist.some((x) => x.ticker === c.ticker)) return;
      const next = [...customWatchlist, c];
      setCustomWatchlistState(next);
      setCustomWatchlist(next);
      void addStockRemote(c);
    },
    [customWatchlist, removedSet, restoreCompany],
  );

  const removeCompany = useCallback(
    (ticker: string) => {
      // A custom-added stock is deleted outright; a synced (portfolio / exited)
      // company is hidden via the removed list so the next sync can't bring it back.
      const custom = customWatchlist.find((x) => x.ticker === ticker);
      if (custom) {
        const next = customWatchlist.filter((x) => x.ticker !== ticker);
        setCustomWatchlistState(next);
        setCustomWatchlist(next);
        void removeStockRemote(custom);
        return;
      }
      if (removedSet.has(ticker.toUpperCase())) return;
      const next = [...removedTickers, ticker];
      setRemovedTickersState(next);
      setRemovedTickers(next);
      void addRemovedRemote(ticker);
    },
    [customWatchlist, removedTickers, removedSet],
  );

  /* ---- derived data ---- */
  const newsItems = data?.news.items ?? [];

  const top5Set = useMemo(
    () => new Set<string>(data?.companies.top5 ?? []),
    [data],
  );

  // Hide news for companies the user removed from the watchlist.
  const visibleItems = useMemo(
    () => newsItems.filter((i) => !removedSet.has(i.ticker.toUpperCase())),
    [newsItems, removedSet],
  );

  const feedItems = useMemo(
    () =>
      feed === 'top5'
        ? visibleItems.filter((i) => top5Set.has(i.ticker))
        : visibleItems.filter((i) => i.scope.includes(feed as Scope)),
    [visibleItems, feed, top5Set],
  );

  const feedCounts = useMemo<Record<FeedKey, number>>(
    () => ({
      top5: visibleItems.filter((i) => top5Set.has(i.ticker)).length,
      portfolio: scopeCount(visibleItems, 'portfolio'),
      watchlist: scopeCount(visibleItems, 'watchlist'),
      universe: scopeCount(visibleItems, 'universe'),
    }),
    [visibleItems, top5Set],
  );

  const knownCompanies = useMemo<Company[]>(() => {
    if (!data) return customWatchlist;
    return [
      ...data.companies.portfolio,
      ...data.companies.watchlist_exited,
      ...customWatchlist,
    ];
  }, [data, customWatchlist]);

  // The watchlist actually shown (removed companies hidden), plus the removed
  // names resolved back to companies so they can be restored.
  const activeCompanies = useMemo<Company[]>(
    () => knownCompanies.filter((c) => !removedSet.has(c.ticker.toUpperCase())),
    [knownCompanies, removedSet],
  );

  const removedCompanies = useMemo<Company[]>(() => {
    const byTicker = new Map(
      knownCompanies.map((c) => [c.ticker.toUpperCase(), c] as const),
    );
    return removedTickers.map(
      (t) => byTicker.get(t.toUpperCase()) ?? { company: t, ticker: t, sector: '' },
    );
  }, [knownCompanies, removedTickers]);

  const trackedTickers = useMemo(
    () => new Set(activeCompanies.map((c) => c.ticker)),
    [activeCompanies],
  );

  /* ---- render ---- */
  return (
    <div className="app-bg min-h-screen">
      <TopBar
        feed={feed}
        feedCounts={feedCounts}
        onFeedChange={setFeed}
        lastUpdated={data?.news.generated_at}
        refreshing={refreshing}
        refreshDisabled={refreshing || refreshCooling}
        refreshNote={refreshNote}
        onRefresh={() => void handleRefresh()}
        onOpenAdd={() => setAddOpen(true)}
        onOpenSubscribe={() => setSubscribeOpen(true)}
        onOpenSources={() => setSourcesOpen(true)}
      />

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        {/* Sub-nav */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Tabs value={tab} onChange={setTab} />
          <p className="text-xs font-medium text-slate-500">
            <span className="font-bold capitalize text-slate-700">{feed}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            {FEED_DESC[feed]}
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-28 text-slate-400">
            <Loader2 className="h-7 w-7 animate-spin" />
            <p className="mt-3 text-sm font-medium">Loading your newsflow…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-white px-6 py-20 text-center ring-1 ring-slate-200/70">
            <AlertTriangle className="h-8 w-8 text-rose-500" />
            <p className="mt-3 text-sm font-bold text-slate-800">
              Couldn&apos;t load the data
            </p>
            <p className="mt-1 max-w-sm text-xs text-slate-500">{error}</p>
            <button
              onClick={() => void fetchData()}
              className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {tab === 'pulse' && <Pulse items={feedItems} />}
            {tab === 'feed' && <Feed key={feed} items={feedItems} />}
            {tab === 'filings' && <Filings filings={data?.filings.items ?? []} />}
          </>
        )}
      </main>

      {data && (
        <AddPanel
          open={addOpen}
          onClose={() => setAddOpen(false)}
          buckets={data.keywords.buckets}
          customKeywords={customKeywords}
          onAddKeywords={addKeywords}
          onRemoveKeyword={removeKeyword}
          knownCompanies={knownCompanies}
          trackedTickers={trackedTickers}
          watchlist={activeCompanies}
          removedCompanies={removedCompanies}
          onAddCompany={addCompany}
          onRemoveCompany={removeCompany}
          onRestoreCompany={restoreCompany}
        />
      )}

      <SubscribePanel open={subscribeOpen} onClose={() => setSubscribeOpen(false)} />

      <SourcesPanel
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        items={newsItems}
      />
    </div>
  );
}
