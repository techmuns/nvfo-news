// The ONE data layer. For Prompt 1 this fetches the committed sample JSON from
// /data/*. Keep ALL data access behind this module so later prompts can point it
// at scraper output / the Worker's /api/* routes with a one-file change.
//
// TODO(Prompt 2): swap these paths for /api/news, /api/filings (Worker-served).

import type {
  CompaniesData,
  KeywordsData,
  NewsData,
  FilingsData,
} from './types';

async function getJSON<T>(path: string): Promise<T> {
  // cache: 'no-cache' so the "Refresh" button always re-checks for new data.
  const res = await fetch(path, {
    headers: { accept: 'application/json' },
    cache: 'no-cache',
  });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export const loadCompanies = () => getJSON<CompaniesData>('/data/companies.json');
export const loadKeywords = () => getJSON<KeywordsData>('/data/keywords.json');
export const loadNews = () => getJSON<NewsData>('/data/news.json');
export const loadFilings = () => getJSON<FilingsData>('/data/filings.json');

export interface AppData {
  companies: CompaniesData;
  keywords: KeywordsData;
  news: NewsData;
  filings: FilingsData;
}

export async function loadAll(): Promise<AppData> {
  const [companies, keywords, news, filings] = await Promise.all([
    loadCompanies(),
    loadKeywords(),
    loadNews(),
    loadFilings(),
  ]);
  return { companies, keywords, news, filings };
}
