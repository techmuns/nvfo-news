// Newsflow company sync (improvement B).
//
// Rebuilds public/data/companies.json from the family office's LIVE holdings
// (ceekay-munshot/nvfo · data/derived/watchlist.json) so the
// tracked list is never a stale hand-maintained snapshot. Runs BEFORE news.mjs
// in the refresh workflow, so the same run scrapes against fresh holdings.
//
// GRACEFUL BY DESIGN: if NVFO_SYNC_TOKEN is unset, the fetch fails, or the
// payload is junk/empty, the committed companies.json is left EXACTLY as-is.
// This step never throws and never blanks the file.

import {
  maybeSetupProxy,
  fetchWithTimeout,
  readJSON,
  writeJSON,
  COMPANIES_PATH,
  nowISO,
} from './lib/util.mjs';

const TOKEN = process.env.NVFO_SYNC_TOKEN || '';
const SRC =
  'https://api.github.com/repos/ceekay-munshot/nvfo/contents/data/derived/watchlist.json';

// Mutual-fund / ETF names we never want in an equity tracker (trailing word).
const FUND_RE = /\b(fund|etf|bees|liquid|arbitrage)\s*$/i;
const isFund = (name) => FUND_RE.test(String(name || '').trim());

// The feed is an array of rows, or an object holding the array under a likely
// key. Anything we don't recognise yields [] (→ graceful keep-existing).
function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const k of ['rows', 'securities', 'watchlist', 'holdings', 'data', 'items']) {
      if (Array.isArray(payload[k])) return payload[k];
    }
  }
  return [];
}

function normRow(row) {
  if (!row || typeof row !== 'object') return null;
  const company = String(row.name ?? row.company ?? '').trim();
  if (!company) return null;
  return {
    company,
    ticker: String(row.ticker ?? '').trim(),
    sector: String(row.sector ?? '').trim(),
    bucket: String(row.bucket ?? '').trim().toLowerCase(),
  };
}

// Union-dedupe by ticker first, then by lowercased name. Order preserved, so
// earlier entries (feed exits) win over later ones (committed exits).
function dedupe(rows) {
  const seenT = new Set();
  const seenN = new Set();
  const out = [];
  for (const r of rows) {
    if (!r || !r.company) continue;
    const t = r.ticker ? r.ticker.toLowerCase() : '';
    const n = r.company.toLowerCase();
    if ((t && seenT.has(t)) || seenN.has(n)) continue;
    if (t) seenT.add(t);
    seenN.add(n);
    out.push(r);
  }
  return out;
}

// { company, ticker, sector } shape for companies.json (drop the bucket field).
const toCompany = (r) => ({ company: r.company, ticker: r.ticker, sector: r.sector });

async function main() {
  await maybeSetupProxy();

  const existing =
    readJSON(COMPANIES_PATH, { portfolio: [], watchlist_exited: [] }) || {
      portfolio: [],
      watchlist_exited: [],
    };
  const existingPortfolio = Array.isArray(existing.portfolio) ? existing.portfolio : [];
  const existingExited = Array.isArray(existing.watchlist_exited) ? existing.watchlist_exited : [];

  if (!TOKEN) {
    console.log('[sync] NVFO_SYNC_TOKEN not set — keeping committed companies.json.');
    return;
  }

  let payload;
  try {
    const res = await fetchWithTimeout(
      SRC,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github.raw',
          'User-Agent': 'newsflow-sync',
        },
      },
      20000,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (e) {
    console.log(`[sync] fetch failed (${e.message}) — keeping committed companies.json.`);
    return;
  }

  const rows = extractRows(payload)
    .map(normRow)
    .filter(Boolean)
    .filter((r) => !isFund(r.company));
  if (rows.length === 0) {
    console.log('[sync] feed empty/unrecognised — keeping committed companies.json.');
    return;
  }

  const heldRows = rows.filter((r) => r.bucket === 'held');
  if (heldRows.length === 0) {
    // A live family office always holds something; zero held = junk/partial feed.
    console.log('[sync] no "held" rows in feed — keeping committed companies.json.');
    return;
  }

  // Every ticker the live feed can represent (held + exited). The family-office
  // feed is NSE-only, so BSE-only holdings (e.g. TANFACIND, YASHHV) never appear
  // in it — we must not let the sync silently drop them.
  const feedTickers = new Set(rows.map((r) => r.ticker.toLowerCase()).filter(Boolean));
  const preserved = existingPortfolio.filter((c) => {
    const t = String(c.ticker || '').toLowerCase();
    return t && !feedTickers.has(t); // committed holding the feed can't express → keep
  });
  const portfolio = dedupe([...heldRows.map(toCompany), ...preserved]);

  // Union of feed exits + committed exits, so a curated exit that has dropped
  // out of the live NSE-tickered feed is never lost.
  const watchlist_exited = dedupe([
    ...rows.filter((r) => r.bucket === 'exited').map(toCompany),
    ...existingExited,
  ]);

  // Skip the write (and the commit churn) when nothing meaningful changed.
  const before = JSON.stringify({ p: existingPortfolio, w: existingExited });
  const after = JSON.stringify({ p: portfolio, w: watchlist_exited });
  if (before === after) {
    console.log(`[sync] unchanged — ${portfolio.length} held, ${watchlist_exited.length} exited.`);
    return;
  }

  writeJSON(COMPANIES_PATH, { generated_at: nowISO(), portfolio, watchlist_exited });
  console.log(
    `[sync] WROTE companies.json — ${portfolio.length} held, ${watchlist_exited.length} exited ` +
      `(feed exits kept + ${existingExited.length} committed exits unioned).`,
  );
}

main().catch((e) => {
  console.error('[sync] fatal:', e);
  process.exit(0); // never break the run — companies.json stays as committed
});
