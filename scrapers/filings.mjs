// Newsflow filings scraper — REAL NSE corporate announcements, fetched DIRECTLY
// (no Firecrawl, no third-party scraper, no API key).
//
// NSE's /api/corporate-announcements is Akamai-protected, so we behave like a
// browser: prime session cookies from the homepage + filings page with full
// browser headers, then call the JSON API per symbol — paced ~1.5s apart, with
// an equities→sme index fallback and a re-prime+retry when a request is denied.
//
// HONESTY GUARDS (never serve placeholders):
//  - only a real ('nse') envelope on disk is trusted as existing data to merge
//    onto; 'sample'/'pending'/anything else is treated as empty;
//  - an item with no source URL (attchmntFile) is dropped;
//  - the file is written ONLY when there are real incoming filings;
//  - on error/empty the committed file is left UNTOUCHED (and the last NSE HTTP
//    status + body snippet is logged for diagnosis).

import {
  maybeSetupProxy,
  readJSON,
  writeJSON,
  FILINGS_PATH,
  loadCompanies,
  fetchWithTimeout,
  mapLimit,
  mergeItems,
  countsByExchange,
  normalizeUrl,
  sha1short,
  stripHtml,
  nowISO,
  daysAgo,
  sleep,
} from './lib/util.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FROM = ddmmyyyy(daysAgo(90));
const TO = ddmmyyyy(new Date());
const MIN_GAP_MS = 1500; // spacing between NSE API calls (Akamai is rate-sensitive)

const CATEGORY_RULES = [
  [/board meeting/i, 'Board Meeting'],
  [/receipt of order|order (win|book|bagg)|awarded|contract|work order|letter of (award|intent)/i, 'Receipt of Order'],
  [/allot|qip|qualified institutional|preferential|rights issue|securities|fund ?rais/i, 'Allotment of Securities'],
  [/buy-?back/i, 'Buyback'],
  [/dividend/i, 'Dividend'],
  [/acquisition|acqui|stake|merger|amalgamation|scheme of arrangement|joint venture/i, 'Acquisition'],
  [/financial results|un-?audited|quarterly results|q[1-4] (fy)?|results for the quarter/i, 'Financial Results'],
  [/investor|analyst|conference call|earnings call|presentation/i, 'Investor Presentation'],
  [/resignation|appointment|cessation|director|kmp|key managerial|change in (management|director)/i, 'Change in Directors'],
  [/credit rating|rating (action|revision|upgrade|downgrade)/i, 'Credit Rating'],
  [/trading window/i, 'Trading Window'],
  [/newspaper (publication|advertisement)/i, 'Newspaper Publication'],
  [/fire|accident|incident|reg\.? ?30|material event|disclosure|update/i, 'Disclosure'],
];

function friendlyCategory(type, title) {
  const s = `${type || ''} ${title || ''}`;
  for (const [re, label] of CATEGORY_RULES) if (re.test(s)) return label;
  return type ? String(type).trim() : 'Announcement';
}

function ddmmyyyy(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseFilingDate(s) {
  if (!s) return new Date();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const m = String(s).match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m && MONTHS[m[2].toLowerCase()] != null) {
    return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  }
  return new Date();
}

// NSE's API returns application/json, but if Akamai serves an HTML challenge we
// strip tags first so JSON.parse fails cleanly (→ treated as denied).
function extractJsonText(content) {
  let t = String(content || '').trim();
  if (t.startsWith('[') || t.startsWith('{')) return t;
  t = t.replace(/<[^>]*>/g, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return t;
}

/* ---- browser-like session (cookies + headers) ---- */
const cookies = new Map();
function absorb(res) {
  let list = [];
  try {
    list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  } catch {
    /* older runtimes */
  }
  if (!list.length) {
    const h = res.headers.get('set-cookie');
    if (h) list = [h];
  }
  for (const c of list) {
    const kv = c.split(';')[0];
    const i = kv.indexOf('=');
    if (i > 0) cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

const commonCH = {
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'accept-language': 'en-US,en;q=0.9',
};
const navHeaders = () => ({
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  ...commonCH,
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
  ...(cookies.size ? { cookie: cookieHeader() } : {}),
});
const apiHeaders = () => ({
  'user-agent': UA,
  accept: 'application/json, text/plain, */*',
  ...commonCH,
  referer: 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'x-requested-with': 'XMLHttpRequest',
  ...(cookies.size ? { cookie: cookieHeader() } : {}),
});

// Global pacing cursor — reserve the next slot synchronously so spacing holds.
let nextSlotAt = 0;
async function pace() {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + MIN_GAP_MS;
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

async function primeNse() {
  for (const u of [
    'https://www.nseindia.com/',
    'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
  ]) {
    try {
      const r = await fetchWithTimeout(u, { headers: navHeaders() }, 20000);
      absorb(r);
      await r.text().catch(() => {});
    } catch {
      /* best-effort */
    }
    await sleep(600);
  }
}

let lastNse = { status: 0, snippet: '' };

async function fetchAnnouncements(symbol, index) {
  await pace();
  const url = `https://www.nseindia.com/api/corporate-announcements?index=${index}&symbol=${encodeURIComponent(
    symbol,
  )}&from_date=${FROM}&to_date=${TO}`;
  let res;
  try {
    res = await fetchWithTimeout(url, { headers: apiHeaders() }, 30000);
  } catch (e) {
    return { denied: true, status: 0, items: null, error: e.message };
  }
  absorb(res);
  const body = await res.text().catch(() => '');
  lastNse = { status: res.status, snippet: body.slice(0, 160).replace(/\s+/g, ' ') };
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(body));
  } catch {
    return { denied: true, status: res.status, items: null };
  }
  const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [];
  return { denied: false, status: res.status, items: arr };
}

function mapItems(arr, company) {
  const out = [];
  for (const x of arr) {
    const src = x.attchmntFile; // the actual announcement PDF
    if (!src) continue; // no source link → never emit
    const desc = stripHtml(x.desc || '');
    out.push({
      id: 'f' + sha1short(normalizeUrl(src)),
      ticker: company.ticker,
      company: company.company,
      exchange: 'NSE',
      date: parseFilingDate(x.an_dt || x.sort_date || x.dt).toISOString(),
      category: friendlyCategory(desc),
      title: stripHtml(x.attchmntText || x.desc || 'Announcement'),
      url: src,
    });
  }
  return out;
}

// One company: try equities, then sme; re-prime+retry once on a denial.
async function nseFilings(company) {
  for (const index of ['equities', 'sme']) {
    let r = await fetchAnnouncements(company.ticker, index);
    if (r.denied) {
      await sleep(2500);
      await primeNse();
      await sleep(1000);
      r = await fetchAnnouncements(company.ticker, index);
    }
    if (r.denied) {
      console.log(`[filings] ${company.ticker} (${index}): denied · HTTP ${r.status}`);
      continue;
    }
    const items = mapItems(r.items, company);
    if (items.length > 0) return items;
    // equities parsed but empty → fall through and try the sme board
  }
  return [];
}

async function main() {
  await maybeSetupProxy();

  const { all: companies } = loadCompanies();
  const existingEnv = readJSON(FILINGS_PATH, { items: [] });
  // Trust ONLY a previously-written real ('nse') envelope as existing data.
  const existing = existingEnv.source === 'nse' ? existingEnv.items || [] : [];
  if (existingEnv.source && existingEnv.source !== 'nse') {
    console.log(
      `[filings] existing file is non-real ('${existingEnv.source}') — ignoring it; only verified NSE filings are ever written.`,
    );
  }

  console.log(`[filings] fetching NSE announcements (direct) for ${companies.length} companies…`);
  await primeNse();
  console.log(`[filings] primed session · ${cookies.size} cookies`);

  // Sequential (concurrency 1) + paced — NSE blocks bursts.
  const per = await mapLimit(companies, 1, (co) => nseFilings(co));
  const incoming = per.flat().filter(Boolean);

  console.log(`[filings] collected ${incoming.length} real filings from NSE.`);
  if (incoming.length === 0) {
    console.log(
      `[filings] No real filings produced — leaving filings.json untouched. Last NSE: HTTP ${lastNse.status} · ${lastNse.snippet}`,
    );
    return;
  }

  const merged = mergeItems(existing, incoming, { retentionDays: 100, cap: 2000 });
  if (merged.items.length === 0) {
    console.log('[filings] Nothing to write after merge — leaving file untouched.');
    return;
  }
  if (merged.added === 0 && merged.removed === 0) {
    console.log('[filings] No new filings and nothing aged out — leaving file untouched.');
    return;
  }

  const envelope = {
    generated_at: nowISO(),
    source: 'nse',
    counts: countsByExchange(merged.items),
    items: merged.items,
  };
  writeJSON(FILINGS_PATH, envelope);
  console.log(
    `[filings] WROTE ${merged.items.length} filings (+${merged.added} new, -${merged.removed} aged out) · ${JSON.stringify(envelope.counts)}`,
  );
  for (const it of merged.items.slice(0, 3)) {
    console.log(`   e.g. ${it.company} · ${it.category} · ${it.url}`);
  }
}

main().catch((e) => {
  console.error('[filings] fatal:', e);
  process.exit(0); // never blank the file on error
});
