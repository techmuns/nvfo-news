// Newsflow Claude enrichment (Prompt 3) — the brain.
//
// Runs AFTER news.mjs and BEFORE filings.mjs. Sends each NEW (enriched !== true)
// news item to Claude on Amazon Bedrock and:
//   - decides KEEP vs DROP (genuine fundamental news vs price/broker/SEO noise),
//   - for kept items sets topic (1 of 6 buckets), mood, importance, and a plain
//     one-line takeaway (<=140 chars),
//   - marks the item enriched:true. Dropped items are removed from news.json.
//
// Bedrock is called with raw HTTPS to the Converse endpoint using a Bedrock API
// key (bearer token) — no AWS SDK / SigV4 / AWS credentials — walking a model
// fallback chain. It runs whenever BEDROCK_API_KEY is set (the model id is
// optional, defaulting to the chain); with no key it is a NO-OP and items keep
// their Prompt-2 defaults. It never breaks the pipeline and never blanks the file.
//
// Local testing without a key: set ENRICH_MOCK=1 to run a deterministic mock
// classifier (no network) that exercises the exact keep/drop + write path.

import {
  readJSON,
  writeJSON,
  NEWS_PATH,
  loadKeywords,
  isBlockedSource,
  collapseDuplicates,
  fetchWithTimeout,
  nowISO,
  countsByScope,
} from './lib/util.mjs';

const BEDROCK_API_KEY = process.env.BEDROCK_API_KEY || '';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const MOCK = process.env.ENRICH_MOCK === '1';

// Model fallback chain (matches techmuns/paramemo). Pin one with BEDROCK_MODEL_ID;
// else a comma-separated BEDROCK_MODEL_IDS; else a default chain. The model id is
// optional now — enrichment runs whenever BEDROCK_API_KEY is set.
const MODEL_CHAIN = process.env.BEDROCK_MODEL_ID
  ? [process.env.BEDROCK_MODEL_ID]
  : process.env.BEDROCK_MODEL_IDS
    ? process.env.BEDROCK_MODEL_IDS.split(',').map((s) => s.trim()).filter(Boolean)
    : [
        'anthropic.claude-sonnet-5',
        'us.anthropic.claude-sonnet-5',
        'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      ];
// TODO(optional): MISTRAL_API_KEY — a cheap first-pass keep/drop before Claude.
// Left unimplemented on purpose; Claude is the authority.

const BATCH_SIZE = 10;
const TOPICS = new Set(['Growth', 'Orders', 'Deals', 'Money', 'Approvals&IP', 'Trouble', 'Other']);
const MOODS = new Set(['positive', 'negative', 'neutral']);
const IMPS = new Set(['high', 'medium', 'low']);
const BUCKET_ORDER = ['Growth', 'Orders', 'Deals', 'Money', 'Approvals&IP', 'Trouble'];

function buildSystemPrompt(keywords) {
  const buckets = BUCKET_ORDER.filter((t) => keywords.buckets?.[t]?.length)
    .map((t) => `- ${t}: ${keywords.buckets[t].join(', ')}`)
    .join('\n');
  return `You are a news classifier for an Indian equity family office. They track ONLY genuine, fundamental BUSINESS news about companies — decisions and events that change the business — and want day-to-day share-price noise removed.

KEEP (genuine fundamental news): orders/contracts, capex/capacity/commissioning, JV/partnership/M&A/stake sale, fundraising (QIP, preferential/rights issue, buyback), patents & regulatory approvals, quarterly results/earnings, corporate governance/fraud/legal/investigation, management changes (resignation/appointment), and plant incidents (fire/accident).

DROP (be STRICT — when in doubt, DROP): share-price moves and "why the stock rose/fell", broker target prices / ratings / recommendations, "stocks to watch / buy", generic market or index wraps (Nifty/Sensex), and data / SEO pages — TradingView or "price to earnings" pages, simplywall.st "stock scans", "market size / CAGR / forecast" reports, and listicle / multibagger / "hidden gems" clickbait. Prefer real reporting over data-aggregator pages.

For each KEPT item assign:
- topic: the closest of these 6 buckets (use the keywords only as a guide; catch the spirit, not the literal word — "blaze at plant" -> Trouble, "bags contract" -> Orders, "to raise funds via QIP" -> Money):
${buckets}
  If it truly fits none, use "Other".
- mood: effect on the company's fundamentals — "positive", "negative", or "neutral".
- importance: "high" (major, market-moving fundamental event), "medium", or "low" (minor/routine).
- takeaway: ONE plain-English sentence, at most 140 characters, no finance jargon a layperson wouldn't understand.

Return ONLY a JSON array — one object per input id — of {id, keep, topic, mood, importance, takeaway}. No prose, no markdown.`;
}

function parseJsonArray(text) {
  const a = text.indexOf('[');
  const b = text.lastIndexOf(']');
  if (a === -1 || b === -1 || b <= a) return [];
  try {
    const parsed = JSON.parse(text.slice(a, b + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// --- Bedrock Converse endpoint (bearer-token auth), one call ---
async function converseOnce(modelId, system, userText) {
  const url = `https://bedrock-runtime.${AWS_REGION}.amazonaws.com/model/${encodeURIComponent(
    modelId,
  )}/converse`;
  const body = {
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: userText }] }],
    inferenceConfig: { temperature: 0, maxTokens: 1500 },
  };
  return fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BEDROCK_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
    60000,
  );
}

// Classify a batch, walking the model chain: 400/403/404 -> next id;
// 429/5xx or network error -> retry the same id once, then next id.
async function classifyBedrock(batch, system) {
  const userText =
    'Classify these news items for an Indian equity investor. Return ONLY a JSON array of {id, keep, topic, mood, importance, takeaway}, no prose.\n' +
    JSON.stringify(batch);
  let lastErr = 'no model attempted';
  for (const modelId of MODEL_CHAIN) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let res = null;
      try {
        res = await converseOnce(modelId, system, userText);
      } catch (e) {
        lastErr = `${modelId}: ${e.message}`;
        if (attempt === 1) continue; // network error — retry same id once
        break; // then next id
      }
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const parts = data?.output?.message?.content;
        const text = Array.isArray(parts) ? parts.map((c) => c?.text || '').join('') : '';
        return parseJsonArray(text);
      }
      lastErr = `${modelId}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`;
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 1) continue; // retry same id once
        break; // then next id
      }
      break; // 400 / 403 / 404 / other — fall through to the next id
    }
  }
  throw new Error(`Bedrock converse failed — ${lastErr}`);
}

// --- Deterministic mock (ENRICH_MOCK=1) — a faithful local stand-in for Claude.
// Keeps genuine fundamental items, drops price-noise / data-SEO / off-topic. Not
// as nuanced as the real model, but exercises the full keep/drop + enrich path.
const POS = /\b(bags?|wins?|won|secures?|awarded|approval|approved|commission|expansion|expand|capex|acquir|buyback|patent|record|profit|jv|joint venture|partnership|surges? in orders|order win)\b/i;
const NEG = /\b(fraud|resign|resigns?|resignation|lawsuit|probe|investigat|downgrade|default|fire|blaze|accident|penalty|fine|scam|halt|recall|slump|shortfall|loss)\b/i;
const JUNK = /\b(price to earnings|p\/?e ratio|forward pe|stock scan|market size|cagr|forecast to \d|target price|price target|multibagger|hidden gems|hidden picks|stocks? to (watch|buy)|52-?week|all-?time (high|low)|in focus|buzzing|why .* (jumped|fell|rose|surged|tanked)|shares? (rise|rises|rose|fall|falls|fell|jump|jumps|slip|slips|surge|surges|plunge|plunges|gain|gains|drop|drops))\b/i;
// Fundamental-event signal — a keyword-less item must show one of these to stay.
const FUND = /\b(order|contract|bags?|wins?|secures?|capex|capacity|expansion|commission|launch|jv|joint venture|partnership|stake|merger|acquir|amalgamat|qip|rights issue|preferential|buyback|dividend|patent|approval|usfda|results?|earnings|profit|revenue|resign|appoint|board meeting|fraud|probe|investigat|lawsuit|fire|blaze|accident|default|downgrade|fund ?rais|raise \d)\b/i;
// Simple "catch the spirit" topic guess when there's no literal keyword hint.
function guessTopic(title) {
  const t = String(title || '');
  if (/\b(order|contract|bags?|wins?|secures?|awarded|orderbook|work order)\b/i.test(t)) return 'Orders';
  if (/\b(jv|joint venture|partner|stake|merger|acquir|amalgamat|demerger)\b/i.test(t)) return 'Deals';
  if (/\b(qip|rights issue|preferential|buyback|dividend|results?|earnings|profit|revenue|fund ?rais|raise \d|placement)\b/i.test(t)) return 'Money';
  if (/\b(patent|approval|approved|usfda|nod|licen[cs]e|certif)\b/i.test(t)) return 'Approvals&IP';
  if (/\b(fraud|resign|lawsuit|probe|investigat|fire|blaze|accident|default|downgrade|penalty|fine|scam|recall)\b/i.test(t)) return 'Trouble';
  if (/\b(capex|capacity|expansion|expand|commission|launch|greenfield|brownfield|plant|facility)\b/i.test(t)) return 'Growth';
  return 'Other';
}
function classifyMock(batch) {
  return batch.map((it) => {
    const title = it.title || '';
    const hasKw = !!it.topicHint;
    if (JUNK.test(title) || isBlockedSource(it.source, '')) return { id: it.id, keep: false };
    if (!hasKw && !FUND.test(title)) return { id: it.id, keep: false }; // off-topic / not fundamental
    const mood = NEG.test(title) ? 'negative' : POS.test(title) ? 'positive' : 'neutral';
    const importance = /\b(crore|billion|bags?|wins?|secures?|acquir|merger|usfda|approval|fraud|buyback|record|qip)\b/i.test(title)
      ? 'high'
      : 'medium';
    return {
      id: it.id,
      keep: true,
      topic: guessTopic(title),
      mood,
      importance,
      takeaway: title.length > 140 ? title.slice(0, 139).trimEnd() + '…' : title,
    };
  });
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  if (!MOCK && !BEDROCK_API_KEY) {
    console.log(
      '[enrich] BEDROCK_API_KEY not set — skipping (items keep Prompt-2 defaults). Set ENRICH_MOCK=1 to test locally.',
    );
    return;
  }

  const env = readJSON(NEWS_PATH, null);
  if (!env || !Array.isArray(env.items) || env.items.length === 0) {
    console.log('[enrich] no news.json items — nothing to do.');
    return;
  }
  const items = env.items;
  const keywords = loadKeywords();
  const system = buildSystemPrompt(keywords);

  const dropIds = new Set();

  // Hard blocklist: drop pure data/SEO pages before spending tokens.
  const candidates = [];
  for (const it of items) {
    if (it.enriched === true) continue;
    if (isBlockedSource(it.source, it.url)) {
      dropIds.add(it.id);
      continue;
    }
    candidates.push(it);
  }
  const preBlocked = dropIds.size;

  console.log(
    `[enrich] ${items.length} items · ${candidates.length} to classify · ${preBlocked} pre-blocked · model ${MOCK ? 'MOCK' : MODEL_CHAIN.join(' → ')}`,
  );

  let enrichedCount = 0;
  const batches = chunk(candidates, BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const payload = batch.map((it) => ({
      id: it.id,
      company: it.company,
      source: it.source,
      title: it.title,
      topicHint: it.keyword || undefined,
    }));

    let verdicts = [];
    try {
      verdicts = MOCK ? classifyMock(payload) : await classifyBedrock(payload, system);
    } catch (e) {
      console.log(`[enrich] batch ${i + 1}/${batches.length} failed (${e.message}) — items retried next run.`);
      continue; // leave this batch unchanged (enriched stays false)
    }

    const vById = new Map();
    for (const v of verdicts) if (v && v.id != null) vById.set(String(v.id), v);

    for (const it of batch) {
      const v = vById.get(String(it.id));
      if (!v || typeof v.keep !== 'boolean') continue; // no verdict -> retry next run
      if (v.keep === false) {
        dropIds.add(it.id);
        continue;
      }
      it.topic = TOPICS.has(v.topic) ? v.topic : it.topic || 'Other';
      it.mood = MOODS.has(v.mood) ? v.mood : 'neutral';
      it.importance = IMPS.has(v.importance) ? v.importance : 'medium';
      let tk = typeof v.takeaway === 'string' && v.takeaway.trim() ? v.takeaway.trim() : it.title;
      if (tk.length > 140) tk = tk.slice(0, 139).trimEnd() + '…';
      it.takeaway = tk;
      it.enriched = true;
      enrichedCount++;
    }
  }

  // Keep the feed = everything not dropped.
  let kept = items.filter((it) => !dropIds.has(it.id));
  // Universe stays clean: drop enriched universe items Claude rated low-importance.
  const beforeUniv = kept.length;
  kept = kept.filter(
    (it) => !(it.enriched === true && (it.scope || []).includes('universe') && it.importance === 'low'),
  );
  const universeDropped = beforeUniv - kept.length;
  const droppedTotal = items.length - kept.length;

  // Collapse near-duplicate stories (same event reported by many sources).
  const beforeCollapse = kept.length;
  kept = collapseDuplicates(kept);
  const collapsed = beforeCollapse - kept.length;

  // Sample of what was dropped, for the run summary.
  const dropSamples = items
    .filter((it) => dropIds.has(it.id))
    .slice(0, 6)
    .map((it) => `“${it.title.slice(0, 70)}” (${it.source})`);

  console.log(
    `[enrich] kept ${kept.length} · dropped ${droppedTotal} (blocked ${preBlocked}, universe-low ${universeDropped}) · collapsed ${collapsed} dupes · newly enriched ${enrichedCount}`,
  );
  if (dropSamples.length) console.log('[enrich] example drops:\n  - ' + dropSamples.join('\n  - '));

  if (enrichedCount === 0 && droppedTotal === 0 && collapsed === 0) {
    console.log('[enrich] no changes — leaving file untouched.');
    return;
  }
  if (kept.length === 0) {
    console.log('[enrich] refusing to write an empty feed — leaving file untouched.');
    return;
  }

  kept.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const out = {
    generated_at: nowISO(),
    source: (env.source || 'google-news') + '+claude',
    counts: countsByScope(kept),
    items: kept,
  };
  writeJSON(NEWS_PATH, out);
  console.log(`[enrich] WROTE ${kept.length} items · ${JSON.stringify(out.counts)}`);
}

main().catch((e) => {
  console.error('[enrich] fatal:', e);
  process.exit(0); // never break the pipeline / blank the file
});
