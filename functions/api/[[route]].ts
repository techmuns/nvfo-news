/// <reference types="@cloudflare/workers-types" />

/**
 * Newsflow API — Cloudflare Pages Functions (single catch-all under /api/*).
 *
 *  - /api/custom      : KV-backed add-keyword / add-stock "memory"
 *  - /api/subscribe   : email digest subscription (KV)     — supports the Top-5 feed
 *  - /api/unsubscribe : one-click unsubscribe (KV)
 *  - /api/run-digests : the hourly digest send, driven by GitHub Actions (send-digests.yml)
 *  - /api/send-now    : "email me this edition now"
 *  - /api/send-test   : authenticated one-off smoke test
 *  - /api/refresh     : dispatch the refresh-news GitHub Actions workflow
 *
 * The built dashboard and /data/*.json are served by Pages statically — Functions
 * only handle /api/*. Everything degrades gracefully: no KV or Munshot email
 * secrets simply means those routes no-op instead of erroring.
 */

import { renderNewspaper, buildSubject, selectItems } from '../../worker/email.mjs';

interface Env {
  NEWSFLOW_KV?: KVNamespace;
  MUNS_TOKEN?: string;
  MUNS_EMAIL?: string;
  MUNS_EMAIL_ENDPOINT?: string;
  SEND_EMPTY?: string;
  SITE_URL?: string;
  SEND_TEST_KEY?: string;
  DIGEST_KEY?: string;
  GH_DISPATCH_TOKEN?: string;
}

interface DigestSummary {
  total: number;
  due: number;
  sent: number;
  quiet: number;
  failed: number;
}

const K_KEYWORDS = 'custom:keywords';
const K_STOCKS = 'custom:stocks';
const K_REMOVED = 'custom:removed'; // tickers hidden from the synced watchlist
const CAP = 200;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DEFAULT_EMAIL_ENDPOINT = 'https://devde.muns.io/email/send/raw';
const FEEDS = ['portfolio', 'watchlist', 'universe', 'top5'];

// On-demand refresh (POST /api/refresh): dispatch the GitHub Actions scrape.
const REFRESH_WORKFLOW = 'refresh-news.yml';
const REFRESH_DISPATCH_URL = `https://api.github.com/repos/techmuns/nvfo-news/actions/workflows/${REFRESH_WORKFLOW}/dispatches`;
const REFRESH_COOLDOWN_SEC = 300;
const K_REFRESH_LAST = 'refresh:last';

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
  origin?: string;
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

// The set of tickers the user has removed from the watchlist (shared via KV).
async function readRemovedSet(kv?: KVNamespace): Promise<Set<string>> {
  if (!kv) return new Set();
  const list = await readList<string>(kv, K_REMOVED);
  return new Set(list.map((t) => String(t).toUpperCase()));
}
function dropRemoved(items: any[], removed: Set<string>): any[] {
  if (!removed.size) return items;
  return items.filter((i) => !removed.has(String(i?.ticker || '').toUpperCase()));
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

// Read a committed static JSON asset (/data/<name>) via the site's own origin.
// /data/* is served statically by Pages, so this never loops back into /api.
async function readAsset(request: Request, name: string): Promise<any> {
  try {
    const res = await fetch(new URL(`/data/${name}`, request.url).toString());
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// The Top-5 tickers, from companies.json (empty if unavailable).
async function loadTop5(request: Request): Promise<string[]> {
  const companies = await readAsset(request, 'companies.json');
  return Array.isArray(companies?.top5) ? (companies.top5 as string[]) : [];
}

/* ---------------- /api/custom ---------------- */
async function handleCustom(request: Request, env: Env): Promise<Response> {
  const kv = env.NEWSFLOW_KV;
  if (!kv) {
    if (request.method === 'GET') return json({ keywords: [], stocks: [], removed: [] });
    return json({ ok: false, error: 'KV not configured' }, 503);
  }
  if (request.method === 'GET') {
    const [keywords, stocks, removed] = await Promise.all([
      readList<string>(kv, K_KEYWORDS),
      readList<Stock>(kv, K_STOCKS),
      readList<string>(kv, K_REMOVED),
    ]);
    return json({ keywords, stocks, removed });
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
    if (body?.type === 'removed') {
      const value = typeof body.value === 'string' ? body.value.trim().toUpperCase() : '';
      if (!value) return json({ ok: false, error: 'Empty ticker' }, 400);
      let list = await readList<string>(kv, K_REMOVED);
      if (request.method === 'POST') {
        if (!list.some((t) => t.toUpperCase() === value)) list.push(value);
        list = list.slice(0, CAP);
      } else list = list.filter((t) => t.toUpperCase() !== value);
      await kv.put(K_REMOVED, JSON.stringify(list));
      return json({ ok: true, removed: list });
    }
    return json({ ok: false, error: 'Unknown type' }, 400);
  }
  return json({ ok: false, error: 'Method not allowed' }, 405);
}

/* ---------------- /api/subscribe + /api/unsubscribe ---------------- */
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
  let feeds = Array.isArray(body.feeds) ? body.feeds.filter((f) => FEEDS.includes(String(f))) : [];
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
  await kv.put('unsub:' + sub.unsubToken, key);
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

/* ---------------- digest sender ---------------- */
function istParts(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000); // IST = UTC+5:30, no DST
  return { hour: ist.getUTCHours(), weekday: ist.getUTCDay(), dateStr: ist.toISOString().slice(0, 10) };
}
function dayMatches(days: Sub['days'], weekday: number): boolean {
  if (days === 'daily') return true;
  if (days === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (Array.isArray(days)) return days.includes(weekday);
  return false;
}

async function sendEmail(env: Env, to: string, subject: string, body: string): Promise<{ ok: boolean; status: number }> {
  if (!env.MUNS_TOKEN) {
    console.log('[digest] MUNS_TOKEN not set — not sending to', to);
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
    console.log(`[digest] email -> ${to} · HTTP ${res.status} · ${text.slice(0, 200)}`);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    console.log(`[digest] email send error for ${to}:`, (e as Error).message);
    return { ok: false, status: 0 };
  }
}

async function handleSendTest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!env.SEND_TEST_KEY || url.searchParams.get('key') !== env.SEND_TEST_KEY) {
    return json({ ok: false, error: 'Not found', path: url.pathname }, 404);
  }
  const to = String(url.searchParams.get('email') || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return json({ ok: false, error: 'Provide a valid ?email=' }, 400);

  const feeds = (url.searchParams.get('feeds') || 'portfolio,watchlist').split(',').filter((f) => FEEDS.includes(f));
  const news = (await readAsset(request, 'news.json')) || { items: [] };
  const allItems: any[] = dropRemoved(
    Array.isArray(news.items) ? news.items : [],
    await readRemovedSet(env.NEWSFLOW_KV),
  );
  const top5 = await loadTop5(request);
  const items = selectItems(allItems, feeds, 30, top5);
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
  return json({ ok, status, count: items.length });
}

async function runDigests(request: Request, env: Env): Promise<DigestSummary> {
  const summary: DigestSummary = { total: 0, due: 0, sent: 0, quiet: 0, failed: 0 };
  const kv = env.NEWSFLOW_KV;
  if (!kv) {
    console.log('[digest] NEWSFLOW_KV not bound — no subscriptions to process.');
    return summary;
  }
  const ist = istParts();

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
    if (!dayMatches(sub.days, ist.weekday)) continue;
    if (ist.hour < sub.hour) continue;
    if (sub.lastSentDate === ist.dateStr) continue;
    due.push({ key, sub });
  }

  summary.total = keys.length;
  summary.due = due.length;
  if (!due.length) {
    console.log(`[digest] IST ${ist.dateStr} ${ist.hour}:00 — no subscriptions due (${keys.length} total).`);
    return summary;
  }

  const news = (await readAsset(request, 'news.json')) || { items: [] };
  const allItems: any[] = dropRemoved(
    Array.isArray(news.items) ? news.items : [],
    await readRemovedSet(kv),
  );
  const top5 = await loadTop5(request);
  const sendEmptyFlag = env.SEND_EMPTY === 'true';

  for (const { key, sub } of due) {
    try {
      const items = selectItems(allItems, sub.feeds, 30, top5);
      const origin = (sub.origin || env.SITE_URL || '').replace(/\/$/, '');
      const unsubUrl = `${origin}/api/unsubscribe?token=${sub.unsubToken}`;

      if (items.length === 0 && !sendEmptyFlag) {
        sub.lastSentDate = ist.dateStr;
        await kv.put(key, JSON.stringify(sub));
        summary.quiet++;
        continue;
      }

      const body = renderNewspaper({
        items,
        feeds: sub.feeds,
        days: sub.days,
        hour: sub.hour,
        unsubUrl,
        nowIso: new Date().toISOString(),
      });
      const subject = buildSubject(items.length, sub.feeds, new Date().toISOString());
      const sent = await sendEmail(env, sub.email, subject, body);
      if (sent.ok) {
        sub.lastSentDate = ist.dateStr;
        await kv.put(key, JSON.stringify(sub));
        summary.sent++;
      } else {
        summary.failed++;
      }
    } catch (e) {
      summary.failed++;
      console.log('[digest] error for', sub.email, (e as Error).message);
    }
  }

  console.log(
    `[digest] IST ${ist.dateStr} ${ist.hour}:00 — ${summary.sent} sent, ${summary.quiet} quiet, ${summary.failed} failed (${summary.due}/${summary.total} due).`,
  );
  return summary;
}

async function handleRunDigests(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const provided = request.headers.get('x-digest-key') || url.searchParams.get('key') || '';
  if (!env.DIGEST_KEY || provided !== env.DIGEST_KEY) {
    return json({ ok: false, error: 'Not found', path: url.pathname }, 404);
  }
  const summary = await runDigests(request, env);
  return json({ ok: true, ...summary });
}

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

async function handleSendNow(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  let body: { email?: string; feeds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const to = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);

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

  let feeds = Array.isArray(body.feeds) ? body.feeds.filter((f: unknown) => FEEDS.includes(String(f))) : [];
  if (!feeds.length) feeds = ['portfolio', 'watchlist'];
  const news = (await readAsset(request, 'news.json')) || { items: [] };
  const allItems: any[] = dropRemoved(
    Array.isArray(news.items) ? news.items : [],
    await readRemovedSet(kv),
  );
  const top5 = await loadTop5(request);
  const items = selectItems(allItems, feeds, 30, top5);
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

  if (kv && rlKey) {
    stamps.push(Date.now());
    await kv.put(rlKey, JSON.stringify(stamps), { expirationTtl: SENDNOW_WINDOW_SEC });
  }
  return json({ ok, status });
}

/* ---------------- router ---------------- */
export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.pathname === '/api/custom') return handleCustom(request, env);
  if (url.pathname === '/api/subscribe') return handleSubscribe(request, env);
  if (url.pathname === '/api/unsubscribe') return handleUnsubscribe(request, env);
  if (url.pathname === '/api/send-test') return handleSendTest(request, env);
  if (url.pathname === '/api/run-digests') return handleRunDigests(request, env);
  if (url.pathname === '/api/refresh') return handleRefresh(request, env);
  if (url.pathname === '/api/send-now') return handleSendNow(request, env);
  return json({ ok: false, error: 'Not found', path: url.pathname }, 404);
};
