import { useMemo } from 'react';
import { X, Rss, ExternalLink, Globe } from 'lucide-react';
import type { NewsItem } from '../lib/types';

type Channel = { name: string; href: string; note?: string };

// Curated channels we scan (Prompt 5) — the "Where we look" section.
const CHANNELS: Channel[] = [
  { name: 'Google News', href: 'https://news.google.com', note: 'backbone search across publishers' },
  { name: 'Valuepickr forum', href: 'https://forum.valuepickr.com', note: 'investor forum threads' },
  { name: 'NSE', href: 'https://www.nseindia.com', note: 'exchange & corporate filings' },
  { name: 'BSE', href: 'https://www.bseindia.com', note: 'exchange & corporate filings' },
  { name: 'Munshot API', href: 'https://muns.io', note: 'news + filings feed' },
];

// Preferred publishers we weight toward.
const PUBLISHERS: Channel[] = [
  { name: 'Business Standard', href: 'https://www.business-standard.com' },
  { name: 'Mint', href: 'https://www.livemint.com' },
  { name: 'Economic Times', href: 'https://economictimes.indiatimes.com' },
  { name: 'Wall Street Journal', href: 'https://www.wsj.com' },
  { name: 'moneycontrol', href: 'https://www.moneycontrol.com' },
];

function hostOf(u: string): string | null {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Best clickable link for a publisher derived from the feed: prefer a real
// (non-Google-redirect) article host; else the source string if it's a domain;
// else a Google News search for the publisher name.
function publisherHref(source: string, its: NewsItem[]): string {
  for (const it of its) {
    const h = hostOf(it.url);
    if (h && !h.endsWith('google.com')) return `https://${h}`;
  }
  const s = source.trim();
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return `https://${s}`;
  return `https://news.google.com/search?q=${encodeURIComponent(s)}`;
}

function ChannelLink({ c }: { c: Channel }) {
  return (
    <a
      href={c.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200 transition hover:bg-indigo-50/40 hover:ring-indigo-300"
    >
      <Globe className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-indigo-500" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-slate-800">{c.name}</span>
        {c.note && <span className="block truncate text-[11px] text-slate-500">{c.note}</span>}
      </span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-indigo-500" />
    </a>
  );
}

export function SourcesPanel({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: NewsItem[];
}) {
  // Unique `source` values with a story count each, sorted by count desc.
  const publishers = useMemo(() => {
    const map = new Map<string, NewsItem[]>();
    for (const it of items) {
      const s = (it.source || '').trim();
      if (!s) continue;
      const arr = map.get(s);
      if (arr) arr.push(it);
      else map.set(s, [it]);
    }
    return [...map.entries()]
      .map(([source, its]) => ({ source, count: its.length, href: publisherHref(source, its) }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  }, [items]);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!open}
      />
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-label="Sources"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white">
              <Rss className="h-4 w-4" />
            </div>
            <h2 className="font-display text-base font-extrabold text-slate-900">Sources</h2>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* Where we look */}
          <section>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Where we look</h3>
            <p className="mt-1 text-xs text-slate-500">
              Curated channels we scan for fundamental business news.
            </p>
            <div className="mt-2.5 space-y-2">
              {CHANNELS.map((c) => (
                <ChannelLink key={c.name} c={c} />
              ))}
            </div>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Preferred publishers
            </p>
            <div className="mt-2 space-y-2">
              {PUBLISHERS.map((c) => (
                <ChannelLink key={c.name} c={c} />
              ))}
            </div>
          </section>

          {/* Publishers in your feed (live) */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Publishers in your feed (live)
              </h3>
              <span className="text-[11px] font-semibold text-slate-400">{publishers.length}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Auto-derived from the current stories — grows as new publishers appear.
            </p>
            {publishers.length === 0 ? (
              <p className="mt-3 text-xs text-slate-400">No stories loaded yet.</p>
            ) : (
              <div className="mt-2.5 space-y-1.5">
                {publishers.map((p) => (
                  <a
                    key={p.source}
                    href={p.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-slate-200 transition hover:bg-indigo-50/40 hover:ring-indigo-300"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 group-hover:text-indigo-600">
                      {p.source}
                    </span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-500">
                      {p.count}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-indigo-500" />
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
