// Shared helpers for the Newsflow scrapers (Prompt 2).
// Plain Node ESM, Node 20+, global fetch. No front-end code here.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, '..', '..', 'public', 'data');

export const UA =
  'Mozilla/5.0 (compatible; NewsflowBot/1.0; +https://github.com/techmuns/newstracker)';

/* ------------------------------------------------------------------ */
/* Local test proxy (no-op in CI)                                      */
/* ------------------------------------------------------------------ */
// When developing behind the agent proxy, set HTTPS_PROXY and this routes
// global fetch through it via undici. In CI HTTPS_PROXY is unset -> no-op.
export async function maybeSetupProxy() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return;
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(proxy));
    console.log(`[proxy] routing fetch through ${proxy}`);
  } catch (e) {
    console.log(`[proxy] undici unavailable, using direct fetch (${e.message})`);
  }
}

/* ------------------------------------------------------------------ */
/* File IO                                                             */
/* ------------------------------------------------------------------ */
export function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

export const NEWS_PATH = path.join(DATA_DIR, 'news.json');
export const FILINGS_PATH = path.join(DATA_DIR, 'filings.json');
export const COMPANIES_PATH = path.join(DATA_DIR, 'companies.json');
export const KEYWORDS_PATH = path.join(DATA_DIR, 'keywords.json');

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */
export function sha1short(str, len = 12) {
  return crypto.createHash('sha1').update(String(str)).digest('hex').slice(0, len);
}

export function nowISO() {
  return new Date().toISOString();
}

export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export function ymd(d) {
  return d.toISOString().slice(0, 10);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanText(s, max = 200) {
  const t = stripHtml(s);
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

export function hostname(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Normalised key for dedupe (not the stored URL).
export function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|oc|ved|usg|ei|sca_|_hsenc|mc_|ref|source|cmpid|ncid)$/i.test(k))
        url.searchParams.delete(k);
    }
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return String(u || '').trim().toLowerCase();
  }
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (e) {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */
export async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, {
      ...opts,
      signal: ac.signal,
      headers: { 'user-agent': UA, ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

export async function fetchText(url, opts = {}, ms = 15000) {
  const res = await fetchWithTimeout(url, opts, ms);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

// Best-effort: follow the Google News redirect to the real publisher URL.
// Falls back to the original link on any failure (the google link still works).
export async function resolveUrl(link) {
  if (process.env.RESOLVE_URLS === '0') return link;
  // Newer Google News RSS links are encrypted redirectors that don't HTTP-302
  // to the publisher (they JS-redirect in a browser). Fetching them just wastes
  // time, so keep the working google link and rely on the `source` field for
  // the publisher name. Non-google links (Munshot/Firecrawl) are resolved.
  if (hostname(link).endsWith('google.com')) return link;
  try {
    const res = await fetchWithTimeout(link, { redirect: 'follow' }, 9000);
    const final = res.url || link;
    const h = hostname(final);
    if (!h || h.endsWith('google.com') || h.includes('consent')) return link;
    return final;
  } catch {
    return link;
  }
}

/* ------------------------------------------------------------------ */
/* Google News RSS                                                     */
/* ------------------------------------------------------------------ */
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

// Query Google News RSS (free, no key). Returns raw {title, link, date, source, snippet}.
export async function googleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query,
  )}&hl=en-IN&gl=IN&ceid=IN:en`;
  const text = await fetchText(url, {}, 20000);
  const doc = xml.parse(text);
  const items = asArray(doc?.rss?.channel?.item);
  return items
    .map((it) => {
      const link = it.link;
      if (!link) return null;
      let source = '';
      if (it.source && typeof it.source === 'object') source = it.source['#text'] || '';
      else if (typeof it.source === 'string') source = it.source;
      let title = stripHtml(it.title || '');
      if (source && title.endsWith(' - ' + source)) {
        title = title.slice(0, -(source.length + 3)).trim();
      } else if (!source) {
        const m = title.match(/\s-\s([^-]{2,40})$/);
        if (m) source = m[1].trim();
      }
      if (!source) source = hostname(link);
      let date = it.pubDate ? new Date(it.pubDate) : new Date();
      if (isNaN(date.getTime())) date = new Date();
      return {
        title,
        link,
        date: date.toISOString(),
        source,
        // Google News RSS <description> is just the title + publisher (no real
        // summary), so we drop it — the takeaway falls back to the clean title.
        snippet: '',
      };
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Keyword matching (the fundamental filter)                           */
/* ------------------------------------------------------------------ */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build a matcher from keywords.json (+ optional custom keywords from KV).
// Longest keyword wins so multi-word phrases ("Receipt of Order") beat their
// sub-words ("Order"). In Prompt 3 a match is a HINT (topic guess), not a hard
// gate — Claude assigns the final bucket. Custom keywords get topic "Other".
export function buildKeywordMatcher(keywordsData, customKeywords = []) {
  const kw2topic = new Map();
  const display = new Map();
  const add = (kw, topic) => {
    const lc = String(kw || '').toLowerCase().trim();
    if (!lc) return;
    if (!kw2topic.has(lc)) kw2topic.set(lc, topic);
    if (!display.has(lc))
      display.set(lc, lc === 'qualified institutional placement' ? 'QIP' : kw);
  };
  for (const [topic, list] of Object.entries(keywordsData.buckets || {}))
    for (const kw of list) add(kw, topic);
  for (const kw of keywordsData.base || [])
    add(kw, kw2topic.get(String(kw).toLowerCase()) || 'Other');
  for (const kw of customKeywords) add(kw, 'Other'); // topic decided by Claude

  const entries = [...kw2topic.keys()]
    .map((lc) => ({
      lc,
      display: display.get(lc),
      topic: kw2topic.get(lc),
      re: new RegExp(`\\b${escapeRe(lc)}\\b`, 'i'),
    }))
    .sort((a, b) => b.lc.length - a.lc.length);

  return {
    match(text) {
      const t = String(text || '');
      for (const e of entries) {
        if (e.re.test(t)) return { keyword: e.display, topic: e.topic };
      }
      return null;
    },
  };
}

// Conservative relevance guard: is this article actually about the company?
// Google News phrase search is fuzzy and returns cross-company results, so we
// require the full name, its distinctive first word, or the ticker in the text.
// (Still crude — Claude does the real relevance judgement in Prompt 3.)
const NAME_STOP = new Set(['the', 'india', 'ltd', 'limited', 'and', 'group']);
export function mentionsCompany(co, text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  if (t.includes(co.company.toLowerCase())) return true;
  const first = co.company.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  if (first.length >= 3 && !NAME_STOP.has(first) && new RegExp(`\\b${first}\\b`).test(t))
    return true;
  const tk = String(co.ticker || '').toLowerCase();
  if (tk.length >= 3 && new RegExp(`\\b${tk}\\b`).test(t)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Crude noise pre-filter (conservative — Claude does the real one)    */
/* ------------------------------------------------------------------ */
const MOVE =
  '(?:rises?|rose|falls?|fell|gains?|gained|slips?|slipped|jumps?|jumped|tumbles?|tumbled|surges?|surged|plunges?|plunged|soars?|soared|drops?|dropped|declines?|declined|rally|rallies|rallied|slumps?|slumped|zoom(?:s|ed)?|spikes?|spiked)';
const EQUITY = '(?:share|shares|stock|stocks|scrip|equity)';

const NOISE = [
  /\btop (gainers|losers)\b/i,
  /\bstocks?\s+to\s+(watch|buy|sell|avoid|add|hold)\b/i,
  /\b52[-\s]?week\b/i,
  /\btarget price\b/i,
  /\bprice target\b/i,
  /\b(buy|sell|hold|accumulate|reduce|neutral|overweight|underweight)\b[^.]{0,18}\b(rating|call|recommendation)\b/i,
  new RegExp(`\\b${EQUITY}\\b[^.]{0,25}\\b${MOVE}\\b`, 'i'),
  new RegExp(`\\b${MOVE}\\b[^.]{0,20}\\b${EQUITY}\\b`, 'i'),
  new RegExp(`\\b${MOVE}\\b[^.]{0,15}(?:\\d+(?:\\.\\d+)?\\s?%|per cent|percent)`, 'i'),
  /^\s*[₹$]?\s*[-+]?\d+(?:\.\d+)?\s*%/,
  /\b(nifty|sensex)\b[^.]{0,25}\b(up|down|higher|lower|close[sd]?|gain|gains|fall|falls|rise|rises|surge|slip|slips|end[s]?)\b/i,
  // SEO / research-report / stock-tip spam (never real fundamental news)
  /\bmarket size\b/i,
  /\bcagr\b/i,
  /\bmarket (research|report|forecast|outlook to)\b/i,
  /\b(hidden gems|hidden picks|multibagger|stocks to buy)\b/i,
];

export function isNoise(title) {
  const t = String(title || '');
  return NOISE.some((re) => re.test(t));
}

// Hard blocklist of pure data / screener / SEO hosts — dropped BEFORE Claude to
// save tokens (Claude still makes the nuanced call on everything else). Matched
// against both the publisher name and the URL host.
const BLOCKED_HOSTS = [
  'simplywall',
  'tradingview',
  'marketscreener',
  'wallmine',
  'stockanalysis',
  'tipranks',
  'barchart',
  'trendlyne',
  'stockedge',
  'screener.in',
  'equitymaster',
  'moneyworks4me',
  'markets.businessinsider',
];

export function isBlockedSource(source, url) {
  const s = String(source || '').toLowerCase();
  const h = hostname(url).toLowerCase();
  return BLOCKED_HOSTS.some((b) => s.includes(b) || h.includes(b));
}

/* ------------------------------------------------------------------ */
/* Companies / scope                                                   */
/* ------------------------------------------------------------------ */
export function loadCompanies() {
  const data = readJSON(COMPANIES_PATH, { portfolio: [], watchlist_exited: [] });
  const portfolio = (data.portfolio || []).map((c) => ({
    ...c,
    scope: ['portfolio', 'watchlist'],
  }));
  const watchlist = (data.watchlist_exited || []).map((c) => ({
    ...c,
    scope: ['watchlist'],
  }));
  return { portfolio, watchlist, all: [...portfolio, ...watchlist] };
}

export function loadKeywords() {
  return readJSON(KEYWORDS_PATH, { base: [], buckets: {} });
}

/* ------------------------------------------------------------------ */
/* Merge / dedupe / retention                                          */
/* ------------------------------------------------------------------ */
function titleKey(it) {
  return `${String(it.title || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${String(
    it.company || '',
  ).toLowerCase()}`;
}

// Merge incoming into existing (existing wins on conflict, so Prompt 3's
// enriched fields are never clobbered by a re-scrape). Sort newest-first,
// drop items older than retentionDays, cap total.
export function mergeItems(existing, incoming, { retentionDays = 45, cap = 500 } = {}) {
  const byUrl = new Map();
  const seenTitles = new Set();

  for (const it of existing) {
    const k = normalizeUrl(it.url);
    if (!byUrl.has(k)) {
      byUrl.set(k, it);
      seenTitles.add(titleKey(it));
    }
  }

  let added = 0;
  for (const it of incoming) {
    if (!it || !it.url) continue;
    const k = normalizeUrl(it.url);
    const tk = titleKey(it);
    if (byUrl.has(k) || seenTitles.has(tk)) continue;
    byUrl.set(k, it);
    seenTitles.add(tk);
    added++;
  }

  let all = [...byUrl.values()];
  const before = all.length;
  const cutoff = Date.now() - retentionDays * 86400000;
  all = all.filter((it) => {
    const t = Date.parse(it.date);
    return isNaN(t) ? true : t >= cutoff;
  });
  const removed = before - all.length;
  all.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (all.length > cap) all = all.slice(0, cap);
  return { items: all, added, removed };
}

export function countsByScope(items) {
  const c = { portfolio: 0, watchlist: 0, universe: 0, total: items.length };
  for (const it of items) {
    for (const s of it.scope || []) if (s in c) c[s]++;
  }
  return c;
}

export function countsByExchange(items) {
  const c = { NSE: 0, BSE: 0, total: items.length };
  for (const it of items) if (it.exchange in c) c[it.exchange]++;
  return c;
}

/* ------------------------------------------------------------------ */
/* Collapse near-duplicate stories (same event from many sources)      */
/* ------------------------------------------------------------------ */
// Stopwords stripped from titles before comparing (numbers/amounts/% are KEPT).
const DUP_STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'at', 'by', 'with', 'from',
  'as', 'its', 'it', 'is', 'are', 'was', 'be', 'has', 'have', 'will', 'after', 'over', 'amid',
  'via', 'said', 'says', 'say', 'report', 'reports', 'update', 'video', 'watch', 'read', 'new',
  'into', 'out', 'up', 'down', 'than', 'that', 'this', 'these', 'those', 'crore', 'cr', 'lakh',
  'billion', 'trillion', 'million', 'rs', 'inr', 'fy', 'q1', 'q2', 'q3', 'q4', 'ltd', 'limited',
  'india', 'indian', 'company', 'stock', 'stocks', 'shares', 'share', 'per', 'cent', 'percent',
  'pm', 'am', 'plans', 'plan', 'eyes', 'sees', 'set', 'gets', 'get', 'announces', 'announce',
]);

// Real publishers rank above aggregators/social when choosing the survivor.
const GOOD_SRC = ['businessstandard', 'livemint', 'mint', 'economictimes', 'moneycontrol', 'cnbctv18', 'hindubusinessline', 'businessline', 'financialexpress', 'reuters', 'bloomberg', 'ndtvprofit', 'zeebiz', 'zeebusiness', 'valuepickr', 'thehindu'];
const WEAK_SRC = ['linkedin', 'sahi', 'investywise', 'univest', 'simplywall', 'tradingview', 'marketscreener', 'midday', 'scanx', 'whalesbook', 'tradebrains', 'indiainfoline', 'ipowatch', 'ipocentral', 'inshorts', 'businessupturn', 'devdiscourse', 'medicaldialogues'];

function srcScore(source) {
  const s = String(source || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (GOOD_SRC.some((g) => s.includes(g))) return 2;
  if (WEAK_SRC.some((w) => s.includes(w))) return 0;
  return 1;
}

function dupTokens(title, company) {
  let t = ' ' + String(title || '').toLowerCase() + ' ';
  t = t.replace(/₹|\brs\.?\b/g, ' '); // currency symbols
  t = t.replace(/(\d),(\d)/g, '$1$2'); // 3,000 -> 3000
  for (const w of String(company || '').toLowerCase().split(/\s+/)) {
    if (w.length >= 3) t = t.split(w).join(' '); // drop company-name words
  }
  t = t.replace(/[^a-z0-9%\s]/g, ' ');
  const out = new Set();
  for (const tok of t.split(/\s+/)) {
    if (!tok) continue;
    if (/\d/.test(tok) || tok.endsWith('%')) {
      out.add(tok); // KEEP numbers / amounts / percentages
      continue;
    }
    if (tok.length < 3 || DUP_STOP.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

function moneySigs(title) {
  const out = new Set();
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(crore|cr|lakh|billion|trillion|million|bn|mn)\b/gi;
  let m;
  while ((m = re.exec(String(title || '').toLowerCase()))) {
    let unit = m[2];
    if (unit === 'cr') unit = 'crore';
    else if (unit === 'bn') unit = 'billion';
    else if (unit === 'mn') unit = 'million';
    out.add(`${m[1].replace(/,/g, '')}${unit}`);
  }
  return out;
}

const DUP_IMP = { high: 0, medium: 1, low: 2 };

// Collapse near-duplicate stories into one. Only ever merges items that share
// the SAME ticker/company AND topic (universe items group by their theme label,
// which is carried in `company`); never across companies or topics. Two items
// are the same event when their normalised titles overlap >= 0.6 (overlap
// coefficient), or they share a distinctive money amount + the same keyword.
// Keeps one survivor per cluster: best source, then importance, then a takeaway,
// then newest; and sets survivor.sources_count when it stands in for >1 report.
export function collapseDuplicates(items) {
  const groups = new Map();
  for (const it of items) {
    const key = `${(it.ticker || '').toLowerCase()}|${(it.company || '').toLowerCase()}|${it.topic}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  const tokCache = new Map();
  const moneyCache = new Map();
  const tok = (it) => {
    if (!tokCache.has(it)) tokCache.set(it, dupTokens(it.title, it.company));
    return tokCache.get(it);
  };
  const money = (it) => {
    if (!moneyCache.has(it)) moneyCache.set(it, moneySigs(it.title));
    return moneyCache.get(it);
  };
  const sameEvent = (a, b) => {
    const ta = tok(a);
    const tb = tok(b);
    const denom = Math.min(ta.size, tb.size);
    if (denom > 0) {
      let inter = 0;
      for (const x of ta) if (tb.has(x)) inter++;
      if (inter / denom >= 0.6) return true;
    }
    if (a.keyword && a.keyword === b.keyword) {
      const mb = money(b);
      for (const x of money(a)) if (mb.has(x)) return true;
    }
    return false;
  };

  const survivors = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      survivors.push(group[0]);
      continue;
    }
    const clusters = [];
    for (const it of group) {
      let placed = false;
      for (const cl of clusters) {
        if (cl.some((m) => sameEvent(it, m))) {
          cl.push(it);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([it]);
    }
    for (const cl of clusters) {
      cl.sort((a, b) => {
        const sa = srcScore(a.source);
        const sb = srcScore(b.source);
        if (sa !== sb) return sb - sa; // best source first
        const ia = DUP_IMP[a.importance] ?? 1;
        const ib = DUP_IMP[b.importance] ?? 1;
        if (ia !== ib) return ia - ib; // high > medium > low
        const tka = a.takeaway && a.takeaway.trim() ? 1 : 0;
        const tkb = b.takeaway && b.takeaway.trim() ? 1 : 0;
        if (tka !== tkb) return tkb - tka; // has a takeaway
        return String(b.date || '').localeCompare(String(a.date || '')); // newest
      });
      const survivor = cl[0];
      if (cl.length > 1) survivor.sources_count = cl.length;
      survivors.push(survivor);
    }
  }
  return survivors;
}
