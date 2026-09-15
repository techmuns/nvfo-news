// Pure aggregation helpers used by the Pulse charts. All bucketing is done on
// the IST calendar-date portion of each ISO string to avoid timezone drift.

import type { NewsItem, Topic, Mood } from './types';
import { TOPIC_ORDER, MOOD_ORDER } from './theme';

export function isoDay(s: string): string {
  return s.slice(0, 10); // "2026-09-02T..." -> "2026-09-02"
}

export function maxDay(items: NewsItem[]): string {
  let m = '';
  for (const it of items) {
    const d = isoDay(it.date);
    if (d > m) m = d;
  }
  return m || new Date().toISOString().slice(0, 10);
}

// Today's date (YYYY-MM-DD) in IST — the honest right edge of the timeline.
export function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export interface DayPoint {
  key: string;
  label: string;
  count: number;
}

// Counts per day for the last `days` days, ending on `endDay` (YYYY-MM-DD).
export function dailyCounts(
  items: NewsItem[],
  days: number,
  endDay: string,
): DayPoint[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const k = isoDay(it.date);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const end = new Date(endDay + 'T00:00:00Z');
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    out.push({ key, label, count: counts.get(key) ?? 0 });
  }
  return out;
}

export interface TopicPoint {
  topic: Topic;
  count: number;
}

export function topicCounts(items: NewsItem[]): TopicPoint[] {
  const map = new Map<Topic, number>();
  for (const it of items) map.set(it.topic, (map.get(it.topic) ?? 0) + 1);
  return TOPIC_ORDER.filter((t) => (map.get(t) ?? 0) > 0).map((t) => ({
    topic: t,
    count: map.get(t)!,
  }));
}

export interface CompanyPoint {
  company: string;
  count: number;
}

export function companyCounts(items: NewsItem[], top = 8): CompanyPoint[] {
  const map = new Map<string, number>();
  for (const it of items) map.set(it.company, (map.get(it.company) ?? 0) + 1);
  return [...map.entries()]
    .map(([company, count]) => ({ company, count }))
    .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company))
    .slice(0, top);
}

export interface MoodPoint {
  mood: Mood;
  count: number;
}

export function moodCounts(items: NewsItem[]): MoodPoint[] {
  const map = new Map<Mood, number>();
  for (const it of items) map.set(it.mood, (map.get(it.mood) ?? 0) + 1);
  return MOOD_ORDER.map((m) => ({ mood: m, count: map.get(m) ?? 0 }));
}

// Top N high-importance items, newest first — used by the highlights strip.
export function topHighlights(items: NewsItem[], n = 5): NewsItem[] {
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...items]
    .sort(
      (a, b) =>
        rank[a.importance] - rank[b.importance] ||
        b.date.localeCompare(a.date),
    )
    .slice(0, n);
}
