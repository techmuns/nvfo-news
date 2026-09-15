import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileX2, ArrowUpDown, ShieldCheck } from 'lucide-react';
import type { Filing, Exchange } from '../lib/types';
import { formatDateTime } from '../lib/format';
import { Avatar } from '../components/ui/Avatar';
import { Pill } from '../components/ui/Pill';
import { EmptyState } from '../components/ui/EmptyState';

const EXCHANGE_PILL: Record<Exchange, string> = {
  NSE: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200',
  BSE: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
};

// Two-level taxonomy grouping the filing `category` values into 5 parents.
// Anything not listed here falls under "Other Disclosures".
const OTHER_PARENT = 'Other Disclosures';
const TAXONOMY: { parent: string; children: string[] }[] = [
  {
    parent: 'Business & Growth',
    children: ['Receipt of Order', 'Acquisition', 'Capacity addition', 'Agreements', 'Diversification/Disinvestment'],
  },
  {
    parent: 'Capital & Returns',
    children: ['Allotment of Securities', 'Buyback', 'Dividend', 'ESOP/ESOS/ESPS', 'Record Date', 'Bonus'],
  },
  { parent: 'Financials', children: ['Financial Results', 'Investor Presentation', 'Credit Rating'] },
  {
    parent: 'Governance',
    children: [
      'Board Meeting',
      'Change in Directors',
      'Trading Window',
      'Shareholders meeting',
      'Amendment to AOA/MOA',
      'Retirement',
      'Demise',
    ],
  },
  { parent: OTHER_PARENT, children: ['Disclosure', 'Newspaper Publication', 'Announcement'] },
];
const CATEGORY_TO_PARENT = new Map<string, string>();
for (const { parent, children } of TAXONOMY) for (const c of children) CATEGORY_TO_PARENT.set(c, parent);
const parentOf = (category: string) => CATEGORY_TO_PARENT.get(category) || OTHER_PARENT;

function MiniSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="min-w-[8rem] cursor-pointer rounded-lg border-0 bg-white py-2 pl-3 pr-8 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 transition focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-50"
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

export function Filings({ filings }: { filings: Filing[] }) {
  const [company, setCompany] = useState<string>('All');
  const [exchange, setExchange] = useState<string>('All');
  const [parentCat, setParentCat] = useState<string>('All');
  const [subCat, setSubCat] = useState<string>('All');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [visible, setVisible] = useState(50); // paginate: 50 rows, +50 per "Load more"

  const companies = useMemo(
    () =>
      [...new Set(filings.map((f) => f.company))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [filings],
  );

  // Sub-category options cascade from the chosen parent: the distinct filing
  // categories actually present under it (so "Other Disclosures" also surfaces
  // unmapped types). Empty when Category = All.
  const subOptions = useMemo(() => {
    if (parentCat === 'All') return [];
    const set = new Set<string>();
    for (const f of filings) if (parentOf(f.category) === parentCat) set.add(f.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [filings, parentCat]);

  // Changing the parent resets the sub-category.
  const onParentChange = (v: string) => {
    setParentCat(v);
    setSubCat('All');
  };

  const shown = useMemo(() => {
    const out = filings.filter((f) => {
      if (company !== 'All' && f.company !== company) return false;
      if (exchange !== 'All' && f.exchange !== exchange) return false;
      if (parentCat !== 'All' && parentOf(f.category) !== parentCat) return false;
      if (subCat !== 'All' && f.category !== subCat) return false;
      return true;
    });
    out.sort((a, b) =>
      sort === 'newest'
        ? b.date.localeCompare(a.date)
        : a.date.localeCompare(b.date),
    );
    return out;
  }, [filings, company, exchange, parentCat, subCat, sort]);

  // Any filter (or sort) change resets pagination to the first page.
  useEffect(() => {
    setVisible(50);
  }, [company, exchange, parentCat, subCat, sort]);

  // No filings at all → honest "coming soon" state. We never fall back to a
  // sample: the filings feed shows verified NSE/BSE disclosures or nothing.
  if (filings.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Live regulatory filings coming soon"
        hint="We only show verified NSE/BSE disclosures, never placeholders."
      />
    );
  }

  const pageItems = shown.slice(0, visible);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white/70 p-3 ring-1 ring-slate-200/70 backdrop-blur">
        <MiniSelect
          label="Company"
          value={company}
          options={[
            { value: 'All', label: 'All companies' },
            ...companies.map((c) => ({ value: c, label: c })),
          ]}
          onChange={setCompany}
        />
        <MiniSelect
          label="Exchange"
          value={exchange}
          options={[
            { value: 'All', label: 'Both' },
            { value: 'NSE', label: 'NSE' },
            { value: 'BSE', label: 'BSE' },
          ]}
          onChange={setExchange}
        />
        <MiniSelect
          label="Category"
          value={parentCat}
          options={[
            { value: 'All', label: 'All categories' },
            ...TAXONOMY.map((t) => ({ value: t.parent, label: t.parent })),
          ]}
          onChange={onParentChange}
        />
        <MiniSelect
          label="Sub-category"
          value={subCat}
          disabled={parentCat === 'All'}
          options={[
            { value: 'All', label: parentCat === 'All' ? 'All' : 'All sub-categories' },
            ...subOptions.map((c) => ({ value: c, label: c })),
          ]}
          onChange={setSubCat}
        />
        <button
          onClick={() => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'))}
          className="mb-0.5 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-900"
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          {sort === 'newest' ? 'Newest first' : 'Oldest first'}
        </button>
        <p className="mb-1 ml-auto text-xs text-slate-500">
          Showing{' '}
          <span className="font-bold tabular-nums text-slate-700">
            {pageItems.length.toLocaleString('en-IN')}
          </span>{' '}
          of{' '}
          <span className="font-bold tabular-nums text-slate-700">
            {shown.length.toLocaleString('en-IN')}
          </span>{' '}
          announcements
        </p>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={FileX2}
          title="No filings match these filters"
          hint="Try a different company, exchange, or category."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
          {/* Header (desktop) */}
          <div className="hidden grid-cols-[1.6fr_auto_1fr_auto] items-center gap-4 border-b border-slate-100 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 md:grid">
            <span>Company</span>
            <span>Exchange</span>
            <span>Announcement</span>
            <span className="text-right">Date</span>
          </div>

          <ul className="divide-y divide-slate-100">
            {pageItems.map((f) => (
              <li key={f.id}>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group grid grid-cols-1 items-center gap-2 px-4 py-3 transition hover:bg-slate-50 md:grid-cols-[1.6fr_auto_1fr_auto] md:gap-4"
                >
                  {/* Company */}
                  <div className="flex items-center gap-2.5">
                    <Avatar name={f.company} size={34} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800">
                        {f.company}
                      </p>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        {f.ticker}
                      </p>
                    </div>
                  </div>

                  {/* Exchange + category (category shown inline on mobile) */}
                  <div className="flex items-center gap-2">
                    <Pill className={EXCHANGE_PILL[f.exchange]}>
                      {f.exchange}
                    </Pill>
                    <Pill className="bg-slate-100 text-slate-600 ring-1 ring-slate-200 md:hidden">
                      {f.category}
                    </Pill>
                  </div>

                  {/* Announcement */}
                  <div className="min-w-0">
                    <p className="hidden text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:block">
                      {f.category}
                    </p>
                    <p className="flex items-start gap-1 text-sm font-medium text-slate-700 group-hover:text-indigo-600">
                      <span className="line-clamp-2">{f.title}</span>
                      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-indigo-500" />
                    </p>
                  </div>

                  {/* Date */}
                  <p className="whitespace-nowrap text-left text-xs tabular-nums text-slate-500 md:text-right">
                    {formatDateTime(f.date)}
                  </p>
                </a>
              </li>
            ))}
          </ul>

          {visible < shown.length && (
            <button
              onClick={() => setVisible((v) => v + 50)}
              className="w-full border-t border-slate-100 px-4 py-3 text-sm font-bold text-indigo-600 transition hover:bg-slate-50"
            >
              Load {Math.min(50, shown.length - visible)} more
              <span className="font-medium text-slate-400">
                {' '}· {(shown.length - visible).toLocaleString('en-IN')} remaining
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
