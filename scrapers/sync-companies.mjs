// Newsflow company sync (improvement B).
//
// Rebuilds public/data/companies.json from the family office's LIVE holdings
// (ceekay-munshot/nvfo · data/derived/watchlist.json) so the tracked list is
// never a stale hand-maintained snapshot. It ALSO reads data/derived/
// family-lookthrough.json to mark the Top-5 holdings by family weight
// (pctOfFamily = a security's share of total family net worth). Runs BEFORE
// news.mjs in the refresh workflow.
//
// GRACEFUL BY DESIGN: if NVFO_SYNC_TOKEN is unset, a fetch fails, or a payload
// is junk/empty, the committed companies.json is left EXACTLY as-is (the Top-5
// falls back to whatever is already committed). This step never throws and
// never blanks the file.

import {
  maybeSetupProxy,
  fetchWithTimeout,
  readJSON,
  writeJSON,
  COMPANIES_PATH,
  nowISO,
} from './lib/util.mjs';

const TOKEN = process.env.NVFO_SYNC_TOKEN || '';
const REPO = 'ceekay-munshot/nvfo';
const WATCHLIST_SRC = `https://api.github.com/repos/${REPO}/contents/data/derived/watchlist.json`;
const LOOKTHROUGH_SRC = `https://api.github.com/repos/${REPO}/contents/data/derived/family-lookthrough.json`;

const TOP_N = 5; // how many biggest holdings make the "Top 5"

const GH_HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github.raw',
  'User-Agent': 'newsflow-sync',
};

async function fetchJSON(url) {
  const res = await fetchWithTimeout(url, { headers: GH_HEADERS }, 20000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Mutual-fund / ETF names we never want in an equity tracker (trailing word).
const FUND_RE = /\b(fund|etf|bees|liquid|arbitrage)\s*$/i;
const isFund = (name) => FUND_RE.test(String(name || '').trim());

// Normalise a company name so the two feeds match (watchlist uses "…Limited",
// the look-through file usually drops it): lowercase, drop the legal suffix +
// punctuation, collapse spaces.
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(limited|ltd|the|inc|plc|corporation|corp|company|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

// Union-dedupe by ticker first, then by lowercased name. Order preserved.
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

// Walk ANY shape of the look-through JSON and collect every security that
// carries a family weight. We do NOT assume which array holds them — we pick up
// every object with BOTH an identity (name/isin) and a numeric pctOfFamily,
// keyed by isin (else normalised name), keeping the LARGEST pctOfFamily seen
// (the family-aggregated figure beats any per-entity slice). This de-dupes the
// same security appearing in crossHeld + the main list + per-entity breakdowns.
function collectWeights(payload) {
  const byKey = new Map(); // key -> { name, pct }
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const pct = Number(node.pctOfFamily);
    const name = typeof node.name === 'string' ? node.name.trim() : '';
    const isin = typeof node.isin === 'string' ? node.isin.trim() : '';
    if ((name || isin) && Number.isFinite(pct) && pct > 0) {
      const key = isin || normName(name);
      const prev = byKey.get(key);
      if (!prev || pct > prev.pct) byKey.set(key, { name, pct });
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(payload);
  return [...byKey.values()].filter((s) => s.name).sort((a, b) => b.pct - a.pct);
}

// Rank the portfolio's Top-5 tickers by family weight.
// Returns { top5: [ticker], weights: Map(ticker->pct), top5Sum } or null.
function computeTop5(lookthrough, portfolio) {
  const ranked = collectWeights(lookthrough);
  if (ranked.length === 0) return null;

  const tickerByNorm = new Map();
  for (const c of portfolio) {
    const k = normName(c.company);
    if (k && !tickerByNorm.has(k)) tickerByNorm.set(k, c.ticker);
  }

  const weights = new Map(); // ticker -> pct (highest match wins)
  const unmatched = [];
  for (const s of ranked) {
    const ticker = tickerByNorm.get(normName(s.name));
    if (ticker) {
      if (!weights.has(ticker)) weights.set(ticker, s.pct);
    } else if (unmatched.length < 8) {
      unmatched.push(`${s.name} (${s.pct}%)`);
    }
  }
  if (unmatched.length) {
    console.log(`[sync] top holdings not matched to a portfolio ticker: ${unmatched.join('; ')}`);
  }

  const top5 = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([t]) => t);
  const top5Sum = top5.reduce((s, t) => s + (weights.get(t) || 0), 0);
  return { top5, weights, top5Sum };
}

async function main() {
  await maybeSetupProxy();

  const existing =
    readJSON(COMPANIES_PATH, { portfolio: [], watchlist_exited: [] }) || {
      portfolio: [],
      watchlist_exited: [],
    };
  const existingPortfolio = Array.isArray(existing.portfolio) ? existing.portfolio : [];
  const existingExited = Array.isArray(existing.watchlist_exited) ? existing.watchlist_exited : [];
  const existingTop5 = Array.isArray(existing.top5) ? existing.top5 : [];

  if (!TOKEN) {
    console.log('[sync] NVFO_SYNC_TOKEN not set — keeping committed companies.json.');
    return;
  }

  let payload;
  try {
    payload = await fetchJSON(WATCHLIST_SRC);
  } catch (e) {
    console.log(`[sync] watchlist fetch failed (${e.message}) — keeping committed companies.json.`);
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
  // feed is NSE-only, so BSE-only holdings never appear in it — we must not let
  // the sync silently drop them.
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

  // ---- Top-5 by family weight (graceful: keep prior Top-5 on any failure) ----
  let top5 = existingTop5;
  let weights = null;
  try {
    const lookthrough = await fetchJSON(LOOKTHROUGH_SRC);
    const r = computeTop5(lookthrough, portfolio);
    if (r && r.top5.length) {
      top5 = r.top5;
      weights = r.weights;
      const declared = Number(lookthrough?.concentration?.top5Pct);
      console.log(
        `[sync] Top-5 by weight: ${top5.join(', ')} · sum ${r.top5Sum.toFixed(1)}%` +
          (Number.isFinite(declared) ? ` (file top5Pct: ${declared}%)` : ''),
      );
    } else {
      console.log('[sync] look-through parsed but no weights matched — keeping prior Top-5.');
    }
  } catch (e) {
    console.log(`[sync] look-through fetch failed (${e.message}) — keeping prior Top-5.`);
  }

  // Attach weightPct to matched portfolio entries (for display / sorting).
  const round2 = (n) => Math.round(n * 100) / 100;
  const portfolioOut = portfolio.map((c) =>
    weights && weights.has(c.ticker) ? { ...c, weightPct: round2(weights.get(c.ticker)) } : c,
  );

  // Skip the write (and the commit churn) when nothing meaningful changed.
  const before = JSON.stringify({ p: existingPortfolio, w: existingExited, t: existingTop5 });
  const after = JSON.stringify({ p: portfolioOut, w: watchlist_exited, t: top5 });
  if (before === after) {
    console.log(
      `[sync] unchanged — ${portfolioOut.length} held, ${watchlist_exited.length} exited, Top-5 [${top5.join(', ')}].`,
    );
    return;
  }

  writeJSON(COMPANIES_PATH, {
    generated_at: nowISO(),
    top5,
    portfolio: portfolioOut,
    watchlist_exited,
  });
  console.log(
    `[sync] WROTE companies.json — ${portfolioOut.length} held, ${watchlist_exited.length} exited, ` +
      `Top-5 [${top5.join(', ')}].`,
  );
}

main().catch((e) => {
  console.error('[sync] fatal:', e);
  process.exit(0); // never break the run — companies.json stays as committed
});
