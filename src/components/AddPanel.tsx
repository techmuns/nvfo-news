import { useMemo, useState } from 'react';
import { X, Plus, Tag, Building2, Info } from 'lucide-react';
import type { Company } from '../lib/types';
import { TOPIC_ORDER, TOPIC } from '../lib/theme';

function slugTicker(name: string): string {
  return (
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10) || 'CUSTOM'
  );
}

export function AddPanel({
  open,
  onClose,
  buckets,
  customKeywords,
  onAddKeywords,
  onRemoveKeyword,
  knownCompanies,
  trackedTickers,
  customWatchlist,
  onAddCompany,
  onRemoveCompany,
}: {
  open: boolean;
  onClose: () => void;
  buckets: Record<string, string[]>;
  customKeywords: string[];
  onAddKeywords: (words: string[]) => void;
  onRemoveKeyword: (kw: string) => void;
  knownCompanies: Company[];
  trackedTickers: Set<string>;
  customWatchlist: Company[];
  onAddCompany: (c: Company) => void;
  onRemoveCompany: (ticker: string) => void;
}) {
  const [kwInput, setKwInput] = useState('');
  const [coInput, setCoInput] = useState('');

  const suggestions = useMemo(() => {
    const q = coInput.trim().toLowerCase();
    if (!q) return [];
    return knownCompanies
      .filter(
        (c) =>
          !trackedTickers.has(c.ticker) &&
          (c.company.toLowerCase().includes(q) ||
            c.ticker.toLowerCase().includes(q)),
      )
      .slice(0, 6);
  }, [coInput, knownCompanies, trackedTickers]);

  function commitKeywords() {
    const words = kwInput
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length) onAddKeywords(words);
    setKwInput('');
  }

  function addCompany(c: Company) {
    onAddCompany(c);
    setCoInput('');
  }

  function commitFreeCompany() {
    const name = coInput.trim();
    if (!name) return;
    if (suggestions.length) {
      addCompany(suggestions[0]);
      return;
    }
    addCompany({ company: name, ticker: slugTicker(name), sector: 'Custom' });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!open}
      />

      {/* Drawer */}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-label="Add keywords and stocks"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white">
              <Plus className="h-4 w-4" />
            </div>
            <h2 className="font-display text-base font-extrabold text-slate-900">
              Add to Newsflow
            </h2>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-5 py-5">
          {/* ---- Add keywords ---- */}
          <section>
            <div className="mb-1 flex items-center gap-2">
              <Tag className="h-4 w-4 text-indigo-500" />
              <h3 className="text-sm font-bold text-slate-800">Add keywords</h3>
            </div>
            <p className="mb-3 flex items-center gap-1 text-xs text-slate-500">
              <Info className="h-3 w-3" />
              New keywords are included from the next refresh.
            </p>

            <div className="flex gap-2">
              <input
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitKeywords();
                }}
                placeholder="e.g. Capacity utilisation, Demerger"
                className="flex-1 rounded-lg border-0 bg-white py-2 px-3 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                onClick={commitKeywords}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white transition hover:bg-slate-800"
              >
                Add
              </button>
            </div>

            {customKeywords.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Your keywords
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {customKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700 ring-1 ring-indigo-200"
                    >
                      {kw}
                      <button
                        onClick={() => onRemoveKeyword(kw)}
                        className="text-indigo-400 hover:text-indigo-700"
                        aria-label={`Remove ${kw}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Base keywords (always on)
              </p>
              <div className="space-y-2">
                {TOPIC_ORDER.filter((t) => buckets[t]?.length).map((t) => (
                  <div key={t}>
                    <p className={`mb-1 text-[11px] font-bold ${TOPIC[t].text}`}>
                      {TOPIC[t].label}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {buckets[t].map((kw) => (
                        <span
                          key={kw}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TOPIC[t].pill}`}
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ---- Add a stock ---- */}
          <section>
            <div className="mb-1 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-purple-500" />
              <h3 className="text-sm font-bold text-slate-800">
                Add a stock to watchlist
              </h3>
            </div>
            <p className="mb-3 flex items-center gap-1 text-xs text-slate-500">
              <Info className="h-3 w-3" />
              Start typing to pick a known company, or add your own.
            </p>

            <div className="relative">
              <div className="flex gap-2">
                <input
                  value={coInput}
                  onChange={(e) => setCoInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitFreeCompany();
                  }}
                  placeholder="e.g. Tata Motors"
                  className="flex-1 rounded-lg border-0 bg-white py-2 px-3 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={commitFreeCompany}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white transition hover:bg-slate-800"
                >
                  Add
                </button>
              </div>

              {suggestions.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-slate-200">
                  {suggestions.map((c) => (
                    <li key={c.ticker}>
                      <button
                        onClick={() => addCompany(c)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-slate-50"
                      >
                        <span className="font-medium text-slate-700">
                          {c.company}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          {c.ticker}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {customWatchlist.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Your added stocks
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {customWatchlist.map((c) => (
                    <span
                      key={c.ticker}
                      className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-bold text-purple-700 ring-1 ring-purple-200"
                    >
                      {c.company}
                      <button
                        onClick={() => onRemoveCompany(c.ticker)}
                        className="text-purple-400 hover:text-purple-700"
                        aria-label={`Remove ${c.company}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-slate-200 px-5 py-3 text-center text-[11px] text-slate-400">
          Saved on this device.{' '}
          {/* TODO(Prompt 3): move to Cloudflare Worker + KV so the scraper reads these. */}
          <span className="font-semibold">Syncs to the scraper in a later update.</span>
        </div>
      </aside>
    </>
  );
}
