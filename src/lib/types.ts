// All shared TypeScript types for Newsflow. These shapes are FINAL — Prompt 1
// fills them with sample JSON; later prompts drop real scraper / AI output into
// the exact same structures.

export type Scope = 'portfolio' | 'watchlist' | 'universe';

export type Topic =
  | 'Growth'
  | 'Orders'
  | 'Deals'
  | 'Money'
  | 'Approvals&IP'
  | 'Trouble'
  | 'Other';

export type Mood = 'positive' | 'negative' | 'neutral';

export type Importance = 'high' | 'medium' | 'low';

export type Exchange = 'NSE' | 'BSE';

export type FeedKey = 'portfolio' | 'watchlist' | 'universe';

export interface Company {
  company: string;
  ticker: string;
  sector: string;
}

export interface CompaniesData {
  generated_at: string;
  portfolio: Company[];
  watchlist_exited: Company[];
}

export interface KeywordsData {
  base: string[];
  buckets: Record<string, string[]>; // topic bucket -> keywords
}

export interface NewsItem {
  id: string;
  ticker: string;
  company: string;
  sector: string;
  scope: Scope[];
  title: string;
  url: string;
  source: string;
  date: string; // ISO 8601, IST offset
  topic: Topic;
  keyword: string;
  importance: Importance;
  mood: Mood;
  takeaway: string;
  enriched?: boolean; // set by the Claude enrichment step (Prompt 3)
  sources_count?: number; // >1 when this survivor stands in for de-duped reports (Prompt 4)
}

export interface NewsData {
  generated_at: string;
  source: string;
  counts?: Record<string, number>; // written by the scraper (Prompt 2+)
  items: NewsItem[];
}

export interface Filing {
  id: string;
  ticker: string;
  company: string;
  exchange: Exchange;
  date: string;
  category: string;
  title: string;
  url: string;
}

export interface FilingsData {
  generated_at: string;
  source: string;
  counts?: Record<string, number>; // written by the scraper (Prompt 2+)
  items: Filing[];
}
