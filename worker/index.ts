/// <reference types="@cloudflare/workers-types" />

/**
 * Newsflow Cloudflare Worker.
 *
 * - Serves the built static site (dist/) via the ASSETS binding.
 * - /api/custom  : KV-backed add-keyword / add-stock "memory" (Prompt 3).
 * - /api/subscribe, /api/unsubscribe : email digest subscriptions (Prompt 4).
 * - scheduled()  : hourly cron that emails due subscribers a Munshot newspaper.
 *
 * No login — so the write routes are open, matching the client's decision.
 * TODO(security): a shared-secret header (x-newsflow-secret) could gate writes;
 * TODO(email): double opt-in could be added before first send. Not built now.
 *
 * Everything is optional/non-fatal: missing KV or Munshot email secrets just
 * degrade gracefully (localStorage fallback on the client; no send from cron).
 */

import { renderNewspaper, buildSubject, selectItems } from './email.mjs';

export interface Env {
  ASSETS: Fetcher;
  NEWSFLOW_KV?: KVNamespace;
  MUNS_TOKEN?: string;
  MUNS_EMAIL?: string; // from-address (unused by the Raw Email API; kept for reference)
  MUNS_EMAIL_ENDPOINT?: string;
  SEND_EMPTY?: string; // "true" to email on quiet days
  SITE_URL?: string; // fallback origin for unsubscribe links (cron has no request)
  SEND_TEST_KEY?: string; // when set, unlocks GET /api/send-test?email=&key=
  DIGEST_KEY?: string; // when set, unlocks POST /api/run-digests (the hourly trigger)
  GH_DISPATCH_TOKEN?: string; // when set, POST /api/refresh dispatches the scrape workflow
}

interface DigestSummary {
  total: number; // subscriptions on file
  due: number; // due this hour (right day, at/after hour, not yet sent today)
  sent: number;
  quiet: number; // due but no items — marked done for the day
  failed: number;
}

const K_KEYWORDS = 'custom:keywords';
const K_STOCKS = 'custom:stocks';
const CAP = 200;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DEFAULT_EMAIL_ENDPOINT = 'https://devde.muns.io/email/send/raw';

// On-demand refresh (POST /api/refresh): dispatch the GitHub Actions scrape.
const REFRESH_WORKFLOW = 'refresh-news.yml';
const REFRESH_DISPATCH_URL = `https://api.github.com/repos/techmuns/newstracker/actions/workflows/${REFRESH_WORKFLOW}/dispatches`;
const REFRESH_COOLDOWN_SEC = 300; // at most one dispatch per 5 minutes
const K_REFRESH_LAST = 'refresh:last';

// "Email me this edition now" (POST /api/send-now): per-email hourly cap.
const SENDNOW_MAX_PER_HOUR = 3;
const SENDNOW_WINDOW_SEC = 3600;

interface Stock {
  name: string;
  ticker?: string;
}
interface Sub {
  email: string;
  days: 'daily' | 'weekdays' | number[];
  hour: number;
  tz: string;
  feeds: string[];
  createdAt: string;
  unsubToken: string;
  lastSentDate: string | null;
  origin?: string; // site origin captured at subscribe time (for unsub links in cron)
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const html = (s: string, status = 200) =>
  new Response(s, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randToken(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readList<T>(kv: KVNamespace, key: string): Promise<T[]> {
  try {
    const raw = await kv.get(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function normStock(value: unknown): Stock | null {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { name } : null;
  }
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    const ticker = typeof v.ticker === 'string' ? v.ticker.trim() : '';
    if (!name && !ticker) return null;
    return ticker ? { name: name || ticker, ticker } : { name };
  }
  return null;
}

/* ---------------- /api/custom (Prompt 3) ---------------- */
async function handleCustom(request: Request, env: Env): Promise<Response> {
  const kv = env.NEWSFLOW_KV;
  if (!kv) {
    if (request.method === 'GET') return json({ keywords: [], stocks: [] });
    return json({ ok: false, error: 'KV not configured' }, 503);
  }
  if (request.method === 'GET') {
    const [keywords, stocks] = await Promise.all([readList<string>(kv, K_KEYWORDS), readList<Stock>(kv, K_STOCKS)]);
    return json({ keywords, stocks });
  }
  if (request.method === 'POST' || request.method === 'DELETE') {
    let body: { type?: string; value?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ ok: false, error: 'Invalid JSON body' }, 400);
    }
    if (body?.type === 'keyword') {
      const value = typeof body.value === 'string' ? body.value.trim() : '';
      if (!value) return json({ ok: false, error: 'Empty keyword' }, 400);
      let list = await readList<string>(kv, K_KEYWORDS);
      if (request.method === 'POST') {
        if (!list.some((k) => k.toLowerCase() === value.toLowerCase())) list.push(value);
        list = list.slice(0, CAP);
      } else list = list.filter((k) => k.toLowerCase() !== value.toLowerCase());
      await kv.put(K_KEYWORDS, JSON.stringify(list));
      return json({ ok: true, keywords: list });
    }
    if (body?.type === 'stock') {
      const s = normStock(body.value);
      if (!s) return json({ ok: false, error: 'Empty stock' }, 400);
      let list = await readList<Stock>(kv, K_STOCKS);
      const same = (a: Stock, b: Stock) =>
        (a.ticker && b.ticker && a.ticker.toLowerCase() === b.ticker.toLowerCase()) ||
        a.name.toLowerCase() === b.name.toLowerCase();
      if (request.method === 'POST') {
        if (!list.some((x) => same(x, s))) list.push(s);
        list = list.slice(0, CAP);
      } else list = list.filter((x) => !same(x, s));
      await kv.put(K_STOCKS, JSON.stringify(list));
      return json({ ok: true, stocks: list });
    }
    return json({ ok: false, error: 'Unknown type' }, 400);
  }
  return json({ ok: false, error: 'Method not allowed' }, 405);
}

/* ---------------- /api/subscribe + /api/unsubscribe (Prompt 4) ---------------- */
async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  const kv = env.NEWSFLOW_KV;
  if (!kv) return json({ ok: false, error: 'KV not configured' }, 503);

  let body: { email?: string; days?: unknown; hour?: unknown; feeds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);

  let days: Sub['days'] = 'weekdays';
  if (Array.isArray(body.days)) {
    const arr = body.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (arr.length) days = arr;
  } else if (body.days === 'daily' || body.days === 'weekdays') {
    days = body.days;
  }
  let hour = Number(body.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) hour = 7;
  let feeds = Array.isArray(body.feeds)
    ? body.feeds.filter((f) => ['portfolio', 'watchlist', 'universe'].includes(String(f)))
    : [];
  if (!feeds.length) feeds = ['portfolio', 'watchlist'];

  const key = 'sub:' + (await sha256hex(email));
  const prevRaw = await kv.get(key);
  const prev: Sub | null = prevRaw ? (JSON.parse(prevRaw) as Sub) : null;
  const sub: Sub = {
    email,
    days,
    hour,
    tz: 'Asia/Kolkata',
    feeds,
    createdAt: prev?.createdAt || new Date().toISOString(),
    unsubToken: prev?.unsubToken || randToken(),
    lastSentDate: prev?.lastSentDate ?? null,
    origin: new URL(request.url).origin,
  };
  await kv.put(key, JSON.stringify(sub));
  await kv.put('unsub:' + sub.unsubToken, key); // reverse lookup for unsubscribe
  return json({ ok: true, email, days, hour, feeds });
}

function unsubPage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Newsflow</title></head>
<body style="margin:0;background:#f2eee3;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" style="min-height:100vh"><tr><td align="center" valign="middle" style="padding:40px 16px;">
<table role="presentation" width="440" style="max-width:440px;background:#fbf9f3;border:1px solid #d9d2c2;padding:36px 32px;text-align:center;">
<tr><td>
<div style="font-family:Georgia,serif;font-size:26px;font-weight:bold;letter-spacing:6px;color:#1a1712;">MUNSHOT</div>
<div style="border-top:3px double #1a1712;margin:12px auto 18px;width:80px;"></div>
<div style="font-size:16px;color:#1a1712;line-height:1.5;">${message}</div>
<div style="font-size:12px;color:#8a8272;padding-top:18px;">Changed your mind? You can re-subscribe any time from the dashboard.</div>
</td></tr></table>
</td></tr></table></body></html>`;
}

async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') || '';
  const kv = env.NEWSFLOW_KV;
  if (kv && token) {
    const key = await kv.get('unsub:' + token);
    if (key) {
      await kv.delete(key);
      await kv.delete('unsub:' + token);
      return html(unsubPage("You've been unsubscribed. You won't receive the Newsflow brief any more."));
    }
  }
  return html(unsubPage('This unsubscribe link is invalid or already used.'), 200);
}

/* ---------------- scheduled sender (Prompt 4) ---------------- */
function istParts(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000); // IST = UTC+5:30, no DST
  return {
    hour: ist.getUTCHours(),
    weekday: ist.getUTCDay(), // 0=Sun..6=Sat
    dateStr: ist.toISOString().slice(0, 10),
  };
}
function dayMatches(days: Sub['days'], weekday: number): boolean {
  if (days === 'daily') return true;
  if (days === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (Array.isArray(days)) return days.includes(weekday);
  return false;
}

async function readAsset(env: Env, name: string): Promise<any> {
  try {
    const res = await env.ASSETS.fetch(new Request(`https://assets.local/data/${name}`));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Send one email via the Munshot Raw Email API (POST /email/send/raw).
 * Verified live: the endpoint expects a Bearer token and the JSON body
 * { email, subject, html } — the recipient field is "email" (NOT "to"),
 * the content field is "html" (NOT "text"), and there is NO "from" field.
 * Returns { ok, status } so the /api/send-test route can echo the HTTP status.
 */
async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  body: string,
): Promise<{ ok: boolean; status: number }> {
  if (!env.MUNS_TOKEN) {
    console.log('[cron] MUNS_TOKEN not set — not sending to', to);
    return { ok: false, status: 0 };
  }
  const endpoint = env.MUNS_EMAIL_ENDPOINT || DEFAULT_EMAIL_ENDPOINT;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MUNS_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email: to, subject, html: body }),
    });
    const text = await res.text().catch(() => '');
    console.log(`[cron] email -> ${to} · HTTP ${res.status} · ${text.slice(0, 200)}`);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    console.log(`[cron] email send error for ${to}:`, (e as Error).message);
    return { ok: false, status: 0 };
  }
}

/* ---------------- GET /api/send-test?email=&key= (Prompt 4) ----------------
 * A small authenticated smoke test: renders the newspaper for the default
 * feeds from the live news.json and sends ONE real email, so the Munshot
 * Raw Email API wiring can be verified end-to-end. Locked behind SEND_TEST_KEY
 * (a Worker secret) so it can never be triggered by an anonymous visitor. */
async function handleSendTest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // Hidden unless the secret is configured AND the caller's key matches.
  if (!env.SEND_TEST_KEY || url.searchParams.get('key') !== env.SEND_TEST_KEY) {
    return json({ ok: false, error: 'Not found', path: url.pathname }, 404);
  }
  const to = String(url.searchParams.get('email') || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return json({ ok: false, error: 'Provide a valid ?email=' }, 400);

  const feeds = ['portfolio', 'watchlist'];
  const news = (await readAsset(env, 'news.json')) || { items: [] };
  const allItems: any[] = Array.isArray(news.items) ? news.items : [];
  const items = selectItems(allItems, feeds, 30);
  const nowIso = new Date().toISOString();
  const origin = (url.origin || env.SITE_URL || '').replace(/\/$/, '');
  const htmlBody = renderNewspaper({
    items,
    feeds,
    days: 'daily',
    hour: istParts().hour,
    unsubUrl: `${origin}/api/unsubscribe?token=test`,
    nowIso,
  });
  const subject = buildSubject(items.length, feeds, nowIso);
  const { ok, status } = await sendEmail(env, to, subject, htmlBody);
  return json({ ok, status });
}

async function runDigests(env: Env): Promise<DigestSummary> {
  const summary: DigestSummary = { total: 0, due: 0, sent: 0, quiet: 0, failed: 0 };
  const kv = env.NEWSFLOW_KV;
  if (!kv) {
    console.log('[cron] NEWSFLOW_KV not bound — no subscriptions to process.');
    return summary;
  }
  const ist = istParts();

  // Collect all subscription keys (paginated).
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const res: KVNamespaceListResult<unknown> = await kv.list({ prefix: 'sub:', cursor });
    for (const k of res.keys) keys.push(k.name);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);

  const due: { key: string; sub: Sub }[] = [];
  for (const key of keys) {
    const raw = await kv.get(key);
    if (!raw) continue;
    let sub: Sub;
    try {
      sub = JSON.parse(raw) as Sub;
    } catch {
      continue;
    }
    // Due = matching day, at/after the chosen IST hour, not yet sent today.
    if (!dayMatches(sub.days, ist.weekday)) continue;
    if (ist.hour < sub.hour) continue;
    if (sub.lastSentDate === ist.dateStr) continue;
    due.push({ key, sub });
  }

  summary.total = keys.length;
  summary.due = due.length;

  if (!due.length) {
    console.log(`[cron] IST ${ist.dateStr} ${ist.hour}:00 — no subscriptions due (${keys.length} total).`);
    return summary;
  }

  const news = (await readAsset(env, 'news.json')) || { items: [] };
  const allItems: any[] = Array.isArray(news.items) ? news.items : [];
  const sendEmptyFlag = env.SEND_EMPTY === 'true';

  for (const { key, sub } of due) {
    try {
      const items = selectItems(allItems, sub.feeds, 30);
      const origin = (sub.origin || env.SITE_URL || '').replace(/\/$/, '');
      const unsubUrl = `${origin}/api/unsubscribe?token=${sub.unsubToken}`;

      if (items.length === 0 && !sendEmptyFlag) {
        sub.lastSentDate = ist.dateStr; // quiet day handled for today
        await kv.put(key, JSON.stringify(sub));
        summary.quiet++;
        console.log('[cron] quiet day — skipped', sub.email);
        continue;
      }

      const html = renderNewspaper({
        items,
        feeds: sub.feeds,
        days: sub.days,
        hour: sub.hour,
        unsubUrl,
        nowIso: new Date().toISOString(),
      });
      const subject = buildSubject(items.length, sub.feeds, new Date().toISOString());
      const sent = await sendEmail(env, sub.email, subject, html);
      if (sent.ok) {
        sub.lastSentDate = ist.dateStr;
        await kv.put(key, JSON.stringify(sub));
        summary.sent++;
        console.log('[cron] sent', sub.email, `(${items.length} items)`);
      } else {
        summary.failed++;
        console.log('[cron] send failed (will retry next hour):', sub.email);
      }
    } catch (e) {
      summary.failed++;
      console.log('[cron] error for', sub.email, (e as Error).message);
    }
  }

  console.log(
    `[cron] IST ${ist.dateStr} ${ist.hour}:00 — ${summary.sent} sent, ${summary.quiet} quiet, ${summary.failed} failed (${summary.due}/${summary.total} due).`,
  );
  return summary;
}

/* ---------------- POST /api/run-digests (the hourly trigger) ----------------
 * Runs the same digest loop as scheduled(), but over HTTP so GitHub Actions can
 * drive it hourly (.github/workflows/send-digests.yml) — the Cloudflare Free
 * plan caps the account at 5 cron triggers, so we don't spend one here. Locked
 * behind DIGEST_KEY (a Worker secret), passed as the x-digest-key header or a
 * ?key= param; returns 404 when the secret is unset or the key doesn't match so
 * the subscriber blast can never be triggered anonymously. */
async function handleRunDigests(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const provided = request.headers.get('x-digest-key') || url.searchParams.get('key') || '';
  if (!env.DIGEST_KEY || provided !== env.DIGEST_KEY) {
    return json({ ok: false, error: 'Not found', path: url.pathname }, 404);
  }
  const summary = await runDigests(env);
  return json({ ok: true, ...summary });
}

/* ---------------- POST /api/refresh (on-demand scrape) ----------------
 * Lets a visitor pull fresh stories on demand by dispatching the refresh-news
 * GitHub Actions workflow. Rate-limited to one dispatch per 5 minutes via KV.
 * Never 500s: a missing token or a GitHub error is reported as { ok:false, reason }. */
async function handleRefresh(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  if (!env.GH_DISPATCH_TOKEN) return json({ ok: false, reason: 'not_configured' });

  const kv = env.NEWSFLOW_KV;
  if (kv) {
    const last = Number((await kv.get(K_REFRESH_LAST)) || 0);
    const elapsed = (Date.now() - last) / 1000;
    if (last && elapsed < REFRESH_COOLDOWN_SEC) {
      return json({ ok: false, reason: 'cooldown', retryInSec: Math.ceil(REFRESH_COOLDOWN_SEC - elapsed) });
    }
  }

  try {
    const res = await fetch(REFRESH_DISPATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'newsflow',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (res.status === 204) {
      if (kv) await kv.put(K_REFRESH_LAST, String(Date.now()), { expirationTtl: REFRESH_COOLDOWN_SEC });
      return json({ ok: true });
    }
    const text = await res.text().catch(() => '');
    console.log(`[refresh] dispatch failed · HTTP ${res.status} · ${text.slice(0, 200)}`);
    return json({ ok: false, reason: 'dispatch_failed', status: res.status });
  } catch (e) {
    console.log('[refresh] error:', (e as Error).message);
    return json({ ok: false, reason: 'error' });
  }
}

/* ---------------- POST /api/send-now (email me this edition) ----------------
 * Renders the current newspaper (portfolio + watchlist) from news.json and
 * emails it once to { email } via the Munshot Raw Email API. Capped at 3 sends
 * per email per hour via KV (sliding window). Returns { ok, status }. */
async function handleSendNow(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  let body: { email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const to = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);

  // Per-email hourly rate limit (sliding window of send timestamps in KV).
  const kv = env.NEWSFLOW_KV;
  let rlKey = '';
  let stamps: number[] = [];
  if (kv) {
    rlKey = 'sendnow:' + (await sha256hex(to));
    const now = Date.now();
    try {
      const raw = await kv.get(rlKey);
      stamps = raw ? (JSON.parse(raw) as number[]) : [];
    } catch {
      stamps = [];
    }
    stamps = stamps.filter((t) => now - t < SENDNOW_WINDOW_SEC * 1000);
    if (stamps.length >= SENDNOW_MAX_PER_HOUR) return json({ ok: false, reason: 'rate_limited' });
  }

  const feeds = ['portfolio', 'watchlist'];
  const news = (await readAsset(env, 'news.json')) || { items: [] };
  const allItems: any[] = Array.isArray(news.items) ? news.items : [];
  const items = selectItems(allItems, feeds, 30);
  const nowIso = new Date().toISOString();
  const origin = (new URL(request.url).origin || env.SITE_URL || '').replace(/\/$/, '');
  const htmlBody = renderNewspaper({
    items,
    feeds,
    days: 'daily',
    hour: istParts().hour,
    unsubUrl: `${origin}/api/unsubscribe?token=preview`,
    nowIso,
  });
  const subject = buildSubject(items.length, feeds, nowIso);
  const { ok, status } = await sendEmail(env, to, subject, htmlBody);

  // Count the attempt so the endpoint can't be hammered (any post-validation call).
  if (kv && rlKey) {
    stamps.push(Date.now());
    await kv.put(rlKey, JSON.stringify(stamps), { expirationTtl: SENDNOW_WINDOW_SEC });
  }
  return json({ ok, status });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/custom') return handleCustom(request, env);
    if (url.pathname === '/api/subscribe') return handleSubscribe(request, env);
    if (url.pathname === '/api/unsubscribe') return handleUnsubscribe(request, env);
    if (url.pathname === '/api/send-test') return handleSendTest(request, env);
    if (url.pathname === '/api/run-digests') return handleRunDigests(request, env);
    if (url.pathname === '/api/refresh') return handleRefresh(request, env);
    if (url.pathname === '/api/send-now') return handleSendNow(request, env);
    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Not found', path: url.pathname }, 404);

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDigests(env).catch((e) => console.log('[cron] fatal:', (e as Error).message)));
  },
};
