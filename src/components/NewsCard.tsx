import { ExternalLink } from 'lucide-react';
import type { NewsItem } from '../lib/types';
import { TOPIC, MOOD } from '../lib/theme';
import { formatDate } from '../lib/format';
import { Avatar } from './ui/Avatar';
import { Pill } from './ui/Pill';
import { ImportanceBadge } from './ui/ImportanceBadge';

export function NewsCard({ item }: { item: NewsItem }) {
  // Never render a card without a source link.
  if (!item.url) return null;

  const topic = TOPIC[item.topic];
  const mood = MOOD[item.mood];

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex gap-3">
        <Avatar name={item.company} size={44} />

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Pill className={topic.pill}>{topic.label}</Pill>
            <Pill className="bg-slate-100 text-slate-600 ring-1 ring-slate-200">
              {item.keyword}
            </Pill>
            <span className="ml-auto truncate pl-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              {item.company}
            </span>
          </div>

          <h3 className="flex items-start gap-1.5 text-sm font-bold leading-snug text-slate-800 group-hover:text-indigo-600">
            <span className="line-clamp-2">{item.title}</span>
            <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-indigo-500" />
          </h3>

          {item.takeaway && item.takeaway.trim() !== item.title.trim() && (
            <p className="mt-1 line-clamp-2 text-sm text-slate-500">
              {item.takeaway}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
            <span className="font-medium text-slate-500">{item.source}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{formatDate(item.date)}</span>
            <span aria-hidden>·</span>
            <span className={`inline-flex items-center gap-1 ${mood.text}`}>
              <span className={`h-2 w-2 rounded-full ${mood.dot}`} />
              {mood.label}
            </span>
            <span aria-hidden>·</span>
            <ImportanceBadge importance={item.importance} />
            {item.sources_count && item.sources_count > 1 ? (
              <>
                <span aria-hidden>·</span>
                <span className="font-medium text-slate-400">
                  +{item.sources_count - 1} source{item.sources_count - 1 === 1 ? '' : 's'}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </a>
  );
}
