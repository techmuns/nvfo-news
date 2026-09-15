// Valuepickr forum source (Prompt 4). Queries the Valuepickr Discourse forum's
// JSON search for each tracked company and returns raw items in the same shape
// as googleNews(). Best-effort + non-fatal — Valuepickr chatter is often opinion,
// so these flow through the same pipeline and Claude (enrich.mjs) keeps only the
// genuinely fundamental threads. valuepickr.com is a REAL source (not blocklisted).
//
// Discourse rate-limits anonymous /search.json hard, so we (1) PACE requests at
// least MIN_GAP_MS apart across the whole run and (2) BACK OFF on HTTP 429
// (honouring Retry-After) before retrying. Both keep the shape + call site
// unchanged; every error path still logs one line and returns [].

import { fetchWithTimeout, stripHtml, ymd, daysAgo, sleep } from './util.mjs';

const BASE = 'https://forum.valuepickr.com';
// A realistic browser UA — be a good citizen (small concurrency upstream, short timeout).
const VP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MIN_GAP_MS = 1500; // minimum spacing between consecutive Valuepickr requests
const MAX_RETRIES = 2; // extra attempts after a 429
const RETRY_DEFAULT_SEC = 5; // when Retry-After is missing/unparseable
const RETRY_CAP_SEC = 20; // never wait longer than this

// Global pacing cursor. Reserving the next slot synchronously (no await between
// the read and the write) keeps spacing correct even if callers overlap.
let nextSlotAt = 0;
async function pace() {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + MIN_GAP_MS;
  const wait = slot - now;
  if (wait > 0) await sleep(wait);
}

export async function valuepickrSearch(company, sinceDate = ymd(daysAgo(90))) {
  const q = `"${company}" after:${sinceDate}`;
  const url = `${BASE}/search.json?q=${encodeURIComponent(q)}`;

  for (let attempt = 0; ; attempt++) {
    try {
      await pace();
      const res = await fetchWithTimeout(
        url,
        { headers: { 'user-agent': VP_UA, accept: 'application/json' } },
        12000,
      );

      // Rate-limited: honour Retry-After (capped) and retry, up to MAX_RETRIES.
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const ra = Number(res.headers.get('retry-after'));
        const waitSec = Math.min(Number.isFinite(ra) && ra > 0 ? ra : RETRY_DEFAULT_SEC, RETRY_CAP_SEC);
        console.log(`[valuepickr] ${company}: HTTP 429 — backing off ${waitSec}s (retry ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(waitSec * 1000);
        continue;
      }

      // Any other non-OK (incl. a 429 after retries are spent) → today's behaviour.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const topics = new Map();
      for (const t of data.topics || []) topics.set(t.id, t);

      const out = [];
      const seen = new Set();
      for (const p of data.posts || []) {
        const t = topics.get(p.topic_id);
        if (!t || seen.has(p.topic_id)) continue; // one item per thread (newest post)
        seen.add(p.topic_id);
        const slug = t.slug || 'topic';
        let d = new Date(p.created_at || t.last_posted_at || t.created_at || Date.now());
        if (isNaN(d.getTime())) d = new Date();
        out.push({
          title: stripHtml(t.title || t.fancy_title || ''),
          link: `${BASE}/t/${slug}/${t.id}`,
          date: d.toISOString(),
          source: 'Valuepickr',
          snippet: stripHtml(p.blurb || ''),
        });
      }
      return out;
    } catch (e) {
      console.log(`[valuepickr] ${company}: ${e.message}`);
      return [];
    }
  }
}
