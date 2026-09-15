// Local persistence for user customisations (added keywords + watchlist stocks)
// and the light auth flag. Everything goes through these small functions so the
// backing store can be swapped in one file.
//
// TODO(Prompt 3): move custom keywords + watchlist to a Cloudflare Worker + KV
// "memory" so the scraper reads them. The function signatures below are designed
// to stay the same (they can become async) when that swap happens.

import type { Company } from './types';

const KEYWORDS_KEY = 'newsflow.customKeywords.v1';
const WATCHLIST_KEY = 'newsflow.customWatchlist.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

/* ---- custom keywords ---- */

export function getCustomKeywords(): string[] {
  return read<string[]>(KEYWORDS_KEY, []);
}

export function setCustomKeywords(list: string[]): void {
  write(KEYWORDS_KEY, list);
}

/* ---- custom watchlist stocks ---- */

export function getCustomWatchlist(): Company[] {
  return read<Company[]>(WATCHLIST_KEY, []);
}

export function setCustomWatchlist(list: Company[]): void {
  write(WATCHLIST_KEY, list);
}
