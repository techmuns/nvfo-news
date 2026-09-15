// Newsflow news scraper (Prompt 3).
//
// Backbone: Google News RSS (free, no key). Supplement: Munshot news-search
// (MUNS_TOKEN) + optional Firecrawl (FIRECRAWL_API_KEY).
//
// Recall over precision (Prompt 3): keep every item that (a) mentions the
// company and (b) isn't caught by the crude noise / SEO blocklist. A literal
// keyword match is now a HINT (topic guess), not a hard gate — Claude decides
// keep/drop + the real bucket in enrich.mjs. Fallback when the Claude brain is
// OFF (no BEDROCK key): require a literal keyword so the interim feed stays clean.
//
// Custom keywords + watchlist stocks are pulled from the Worker KV (NEWSFLOW_URL)
// and merged in. Writes public/data/news.json; never blanks it.

import {
  maybeSetupProxy,
  readJSON,
  writeJSON,
  NEWS_PATH,
  loadCompanies,
  loadKeywords,
  buildKeywordMatcher,
  isNoise,
  isBlockedSource,
  mentionsCompany,
  googleNews,
  resolveUrl,
  fetchWithTimeout,
  mapLimit,
  mergeItems,
  collapseDuplicates,
  countsByScope,
  normalizeUrl,
  sha1short,
  cleanText,
  stripHtml,
  hostname,
  nowISO,
  daysAgo,
  ymd,
} from './lib/util.mjs';
import { firecrawlNews } from './lib/firecrawl.mjs';
import { valuepickrSearch } from './lib/valuepickr.mjs';

const MUNS_TOKEN = process.env.MUNS_TOKEN || '';
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';
const NEWSFLOW_URL = process.env.NEWSFLOW_URL || '';
const VALUEPICKR = process.env.VALUEPICKR !== '0'; // Valuepickr forum source (on by default)
// Is the Claude brain available downstream? If so we can be loose here and let
// enrich.mjs do the real keep/drop; if not, keep the interim feed keyword-clean.
const BRAIN_ON = !!(process.env.BEDROCK_API_KEY && process.env.BEDROCK_MODEL_ID);

const PER_COMPANY_CAP = 8;
const UNIVERSE_PER_QUERY = 2;
const MAX_UNIVERSE_QUERIES = 14;

// Company-agnostic theme queries for the Universe pass — global keyword stories
// (R32 duty), plus sector/product themes derived from the portfolio.
const UNIVERSE = [
  { q: '"R32 refrigerant" (anti-dumping OR duty OR import)', label: 'R32 Refrigerant', ticker: 'GLOBAL', sector: 'Chemicals', keyword: 'Anti-dumping duty' },
  { q: 'India defence exports order', label: 'India Defence Exports', ticker: 'MACRO', sector: 'Capital Goods', keyword: 'Order' },
  { q: '"optical fibre" (price OR demand OR shortage)', label: 'Optical Fibre', ticker: 'GLOBAL', sector: 'Telecom', keyword: 'Capex' },
  { q: 'PFAS fluorochemical regulation Europe', label: 'PFAS Regulation', ticker: 'GLOBAL', sector: 'Chemicals', keyword: 'Regulation' },
  { q: 'chlor-alkali caustic soda price India', label: 'Chlor-Alkali', ticker: 'GLOBAL', sector: 'Chemicals', keyword: 'Capex' },
  { q: 'India specialty chemicals capacity expansion', label: 'Specialty Chemicals', ticker: 'THEME', sector: 'Chemicals', keyword: 'Capacity Expansion' },
  { q: 'India pharma USFDA approval', label: 'Pharma Approvals', ticker: 'THEME', sector: 'Healthcare', keyword: 'Approval' },
  { q: 'India transformer power equipment order', label: 'Power Equipment', ticker: 'THEME', sector: 'Capital Goods', keyword: 'Order' },
  { q: 'India electronics manufacturing PLI capex', label: 'Electronics / PLI', ticker: 'THEME', sector: 'Consumer Durables', keyword: 'Capex' },
];

const stat = {
  googleKept: 0,
  googleErrors: 0,
  munshotKept: 0,
  firecrawlKept: 0,
  valuepickrKept: 0,
  universeKept: 0,
};

function slugTicker(name) {
  return (
    String(name || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12) || 'CUSTOM'
  );
}

function titleKey(it) {
  return `${String(it.title || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${String(
    it.company || '',
  ).toLowerCase()}`;
}

function toNewsItem(raw, company, matcher) {
  const text = `${raw.title} ${raw.snippet || ''}`;
  if (!mentionsCompany(company, text)) return null; // must be about this company
  if (isNoise(raw.title)) return null; // crude price-noise pre-filter
  if (isBlockedSource(raw.source, raw.link)) return null; // hard data/SEO blocklist
  const hit = matcher.match(text); // HINT only (may be null)
  // Fallback with no brain: require a literal keyword so the feed stays clean.
  if (!BRAIN_ON && !hit) return null;
  const url = raw.link;
  return {
    id: 'n' + sha1short(normalizeUrl(url)),
    ticker: company.ticker,
    company: company.company,
    sector: company.sector || '',
    scope: company.scope,
    title: raw.title,
    url,
    source: raw.source || hostname(url),
    date: raw.date,
    topic: hit ? hit.topic : 'Other', // Claude refines in enrich.mjs
    keyword: hit ? hit.keyword : '',
    importance: 'medium', // enrich.mjs (Claude) sets the real value
    mood: 'neutral',
    takeaway: cleanText(raw.snippet || raw.title, 180) || raw.title,
  };
}

function toUniverseItem(raw, cfg, matcher) {
  if (isNoise(raw.title)) return null;
  if (isBlockedSource(raw.source, raw.link)) return null;
  const hit = matcher.match(`${raw.title} ${raw.snippet || ''}`);
  if (!BRAIN_ON && !hit) return null; // keep universe clean when brain is off
  const url = raw.link;
  return {
    id: 'n' + sha1short(normalizeUrl(url)),
    ticker: cfg.ticker,
    company: cfg.label,
    sector: cfg.sector || '',
    scope: ['universe'],
    title: raw.title,
    url,
    source: raw.source || hostname(url),
    date: raw.date,
    topic: hit?.topic || 'Other',
    keyword: hit?.keyword || cfg.keyword,
    importance: 'medium',
    mood: 'neutral',
    takeaway: cleanText(raw.snippet || raw.title, 180) || raw.title,
  };
}

// Pull custom keywords + watchlist stocks from the Worker KV (Prompt 3).
async function fetchCustom() {
  if (!NEWSFLOW_URL) return { keywords: [], stocks: [] };
  try {
    const res = await fetchWithTimeout(
      `${NEWSFLOW_URL.replace(/\/$/, '')}/api/custom`,
      { headers: { accept: 'application/json' } },
      12000,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const keywords = Array.isArray(j.keywords) ? j.keywords.filter(Boolean) : [];
    const stocks = Array.isArray(j.stocks) ? j.stocks : [];
    console.log(`[custom] KV: ${keywords.length} keywords, ${stocks.length} stocks`);
    return { keywords, stocks };
  } catch (e) {
    console.log(`[custom] fetch failed (${e.message}) — using base lists only.`);
    return { keywords: [], stocks: [] };
  }
}

let munsLogged = false;
async function munshotNews(query) {
  if (!MUNS_TOKEN) return [];
  try {
    const res = await fetchWithTimeout(
      'https://fastapi.muns.io/tools/news-search',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${MUNS_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query,
          country: 'INDIA',
          from_date: ymd(daysAgo(90)),
          to_date: ymd(new Date()),
        }),
      },
      25000,
    );
    const raw = await res.json();
    if (!munsLogged) {
      console.log('[munshot news] sample raw:', JSON.stringify(raw).slice(0, 500));
      munsLogged = true;
    }
    const arr = Array.isArray(raw)
      ? raw
      : raw.items || raw.data || raw.results || raw.news || raw.articles || [];
    return arr
      .map((x) => {
        const link = x.url || x.link || x.source_url;
        if (!link) return null;
        let d = new Date(x.date || x.published_at || x.pubDate || x.publishedAt || Date.now());
        if (isNaN(d.getTime())) d = new Date();
        return {
          title: stripHtml(x.title || x.headline || ''),
          link,
          date: d.toISOString(),
          source: x.source || x.publisher || hostname(link),
          snippet: stripHtml(x.snippet || x.summary || x.description || ''),
        };
      })
      .filter(Boolean);
  } catch (e) {
    console.log(`[munshot news] skip (${e.message})`);
    return [];
  }
}

function dedupeRun(items) {
  const byUrl = new Map();
  const titles = new Set();
  for (const it of items) {
    if (!it || !it.url) continue;
    const k = normalizeUrl(it.url);
    const tk = titleKey(it);
    if (byUrl.has(k) || titles.has(tk)) continue;
    byUrl.set(k, it);
    titles.add(tk);
  }
  return [...byUrl.values()];
}

async function main() {
  await maybeSetupProxy();

  const base = loadCompanies();
  const keywords = loadKeywords();
  const custom = await fetchCustom();

  // Merge custom watchlist stocks into the company list.
  const seenTickers = new Set(base.all.map((c) => c.ticker));
  const customCompanies = [];
  for (const s of custom.stocks) {
    const name = (typeof s === 'string' ? s : s.name || '').trim();
    if (!name) continue;
    const ticker = (typeof s === 'object' && s.ticker) ? s.ticker : slugTicker(name);
    if (seenTickers.has(ticker)) continue;
    seenTickers.add(ticker);
    customCompanies.push({ company: name, ticker, sector: '', scope: ['watchlist'] });
  }
  const companies = [...base.all, ...customCompanies];
  const matcher = buildKeywordMatcher(keywords, custom.keywords);

  const existingEnv = readJSON(NEWS_PATH, { items: [] });
  // Prompt 1 shipped fabricated sample data; discard it on the first real run.
  const existing = existingEnv.source === 'sample' ? [] : existingEnv.items || [];
  if (existingEnv.source === 'sample') {
    console.log('[news] existing file is Prompt-1 sample — replacing with real data.');
  }

  console.log(
    `[news] ${companies.length} companies (+${customCompanies.length} custom) · ${(keywords.base || []).length}+${custom.keywords.length} keywords · brain ${BRAIN_ON ? 'ON' : 'off'} · Munshot ${MUNS_TOKEN ? 'ON' : 'off'}`,
  );

  /* ---- per-company pass ---- */
  const perCompany = await mapLimit(companies, 4, async (co) => {
    const out = [];
    try {
      const g = await googleNews(`"${co.company}" when:90d`);
      for (const raw of g) {
        const it = toNewsItem(raw, co, matcher);
        if (it) {
          out.push(it);
          stat.googleKept++;
        }
      }
    } catch (e) {
      stat.googleErrors++;
      console.log(`[google] ${co.company}: ${e.message}`);
    }
    if (MUNS_TOKEN) {
      const m = await munshotNews(co.company);
      for (const raw of m) {
        const it = toNewsItem(raw, co, matcher);
        if (it) {
          out.push(it);
          stat.munshotKept++;
        }
      }
    }
    // Optional Firecrawl bonus — portfolio names only, to bound credits.
    if (FIRECRAWL_API_KEY && co.scope.includes('portfolio')) {
      const f = await firecrawlNews(co, FIRECRAWL_API_KEY);
      for (const raw of f) {
        const it = toNewsItem(raw, co, matcher);
        if (it) {
          out.push(it);
          stat.firecrawlKept++;
        }
      }
    }
    // Valuepickr forum threads (no key). Opinion-heavy — Claude filters in enrich.
    if (VALUEPICKR) {
      const vp = await valuepickrSearch(co.company);
      for (const raw of vp) {
        const it = toNewsItem(raw, co, matcher);
        if (it) {
          out.push(it);
          stat.valuepickrKept++;
        }
      }
    }
    out.sort((a, b) => b.date.localeCompare(a.date));
    return out.slice(0, PER_COMPANY_CAP);
  });

  let incoming = perCompany.flat().filter(Boolean);

  /* ---- universe pass (themes + custom keywords) ---- */
  const customUniverse = custom.keywords.map((kw) => ({
    q: `${kw} India`,
    label: kw,
    ticker: 'THEME',
    sector: '',
    keyword: kw,
  }));
  const universeQueries = [...UNIVERSE, ...customUniverse].slice(0, MAX_UNIVERSE_QUERIES);
  for (const cfg of universeQueries) {
    try {
      const g = await googleNews(`${cfg.q} when:90d`);
      const kept = [];
      for (const raw of g) {
        const it = toUniverseItem(raw, cfg, matcher);
        if (it) kept.push(it);
      }
      kept.sort((a, b) => b.date.localeCompare(a.date));
      const take = kept.slice(0, UNIVERSE_PER_QUERY);
      incoming.push(...take);
      stat.universeKept += take.length;
    } catch (e) {
      console.log(`[universe] ${cfg.label}: ${e.message}`);
    }
  }

  /* ---- dedupe, resolve non-google URLs, dedupe again ---- */
  incoming = dedupeRun(incoming);
  await mapLimit(incoming, 6, async (it) => {
    const resolved = await resolveUrl(it.url);
    it.url = resolved;
    it.id = 'n' + sha1short(normalizeUrl(resolved));
  });
  incoming = dedupeRun(incoming);

  const sourcesUsed = [];
  if (stat.googleKept > 0 || stat.universeKept > 0) sourcesUsed.push('google-news');
  if (stat.munshotKept > 0) sourcesUsed.push('munshot');
  if (stat.firecrawlKept > 0) sourcesUsed.push('firecrawl');
  if (stat.valuepickrKept > 0) sourcesUsed.push('valuepickr');

  console.log(
    `[news] kept — google:${stat.googleKept} munshot:${stat.munshotKept} firecrawl:${stat.firecrawlKept} valuepickr:${stat.valuepickrKept} universe:${stat.universeKept} · google errors:${stat.googleErrors} · unique incoming:${incoming.length}`,
  );

  if (incoming.length === 0) {
    console.log('[news] No items from any source — leaving news.json untouched.');
    return;
  }

  const merged = mergeItems(existing, incoming, { retentionDays: 100, cap: 2000 });
  // Collapse near-duplicate stories so the feed never shows the same event twice.
  const finalItems = collapseDuplicates(merged.items).sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')),
  );
  const collapsed = merged.items.length - finalItems.length;

  if (finalItems.length === 0) {
    console.log('[news] Nothing to write after merge — leaving file untouched.');
    return;
  }
  if (merged.added === 0 && merged.removed === 0 && collapsed === 0) {
    console.log('[news] No new items, nothing aged out, no dupes — leaving file untouched.');
    return;
  }

  const envelope = {
    generated_at: nowISO(),
    source: sourcesUsed.join('+') || 'google-news',
    counts: countsByScope(finalItems),
    items: finalItems,
  };
  writeJSON(NEWS_PATH, envelope);
  console.log(
    `[news] WROTE ${finalItems.length} items (+${merged.added} new, -${merged.removed} aged, -${collapsed} dupes) · ${JSON.stringify(envelope.counts)}`,
  );
}

main().catch((e) => {
  console.error('[news] fatal:', e);
  // Do not blank the file on a fatal error.
  process.exit(0);
});
