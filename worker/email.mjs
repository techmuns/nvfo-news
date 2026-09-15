// Newsflow newspaper email renderer (Prompt 4).
//
// Pure ESM (no Cloudflare or Node globals) so both the Worker (esbuild) and the
// local preview script (Node) can import it. Produces an email-safe HTML string:
// table layout, all inline CSS, max-width 640px, web-safe fonts. Uses the exact
// dashboard topic + mood colours so the email reads as the same product.

const TOPIC = {
  Growth: { label: 'Growth', color: '#10b981' },
  Orders: { label: 'Orders', color: '#3b82f6' },
  Deals: { label: 'Deals', color: '#8b5cf6' },
  Money: { label: 'Money', color: '#f59e0b' },
  'Approvals&IP': { label: 'Approvals & IP', color: '#14b8a6' },
  Trouble: { label: 'Trouble', color: '#f43f5e' },
  Other: { label: 'Other', color: '#64748b' },
};
const TOPIC_ORDER = ['Growth', 'Orders', 'Deals', 'Money', 'Approvals&IP', 'Trouble', 'Other'];
const MOOD = {
  positive: { label: 'Good', color: '#10b981' },
  negative: { label: 'Watch-out', color: '#f43f5e' },
  neutral: { label: 'Neutral', color: '#94a3b8' },
};
const IMP_RANK = { high: 0, medium: 1, low: 2 };

// Newspaper palette
const INK = '#1a1712';
const PAPER = '#fbf9f3';
const CREAM = '#f2eee3';
const RULE = '#d9d2c2';
const META = '#8a8272';
const LINK = '#b4531f';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(iso, opts) {
  try {
    return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts }).format(new Date(iso));
  } catch {
    return '';
  }
}
const fullDate = (iso) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (iso) => fmt(iso, { day: 'numeric', month: 'short' });

export function hourLabel(h) {
  const hr = ((Number(h) % 24) + 24) % 24;
  const ap = hr < 12 ? 'AM' : 'PM';
  const h12 = hr % 12 === 0 ? 12 : hr % 12;
  return `${h12}:00 ${ap}`;
}

export function editionLabel(feeds) {
  const has = (f) => feeds.includes(f);
  if (has('portfolio') && has('watchlist')) return 'Portfolio & Watchlist';
  if (has('portfolio')) return 'Portfolio';
  if (has('watchlist')) return 'Watchlist';
  if (has('universe')) return 'Universe';
  return 'Newsflow';
}

function cadenceLabel(days) {
  if (days === 'daily') return 'every day';
  if (days === 'weekdays') return 'every weekday';
  return 'on selected days';
}

export function buildSubject(count, feeds, iso) {
  const edition = feeds.includes('portfolio') ? 'portfolio' : feeds.includes('watchlist') ? 'watchlist' : 'feeds';
  const n = count || 0;
  return `Newsflow · ${n} fundamental update${n === 1 ? '' : 's'} on your ${edition} — ${shortDate(iso)}`;
}

// Pick + order the items for one subscriber's edition.
export function selectItems(items, feeds, limit = 30) {
  const inFeed = (it) => (it.scope || []).some((s) => feeds.includes(s));
  let pool = items.filter(inFeed);
  const enriched = pool.filter((it) => it.enriched);
  if (enriched.length) pool = enriched; // once Claude is on, only clean items
  const seen = new Set();
  pool = pool.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
  // Recency-first: the digest carries the most RECENT fundamental updates.
  pool.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return pool.slice(0, limit);
}

function dot(color, size = 9) {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;background:${color};border-radius:50%;vertical-align:middle;"></span>`;
}

function frontStory(it) {
  const t = TOPIC[it.topic] || TOPIC.Other;
  return `
  <tr><td style="padding:16px 0 14px;border-bottom:1px solid ${RULE};">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${t.color};font-weight:bold;padding-bottom:6px;">${esc(t.label)}</div>
    <a href="${esc(it.url)}" style="font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.24;font-weight:bold;color:${INK};text-decoration:none;">${esc(it.title)}</a>
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;font-style:italic;line-height:1.45;color:#4a4438;padding:8px 0 6px;">${esc(it.takeaway || it.title)}</div>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${META};">
      <b style="color:#5c5445;">${esc(it.company)}</b> &nbsp;·&nbsp; ${esc(it.source)} &nbsp;·&nbsp; ${esc(shortDate(it.date))}
      &nbsp;·&nbsp; <a href="${esc(it.url)}" style="color:${LINK};text-decoration:none;font-weight:bold;">Read &rarr;</a>
    </div>
  </td></tr>`;
}

function sectionStory(it) {
  const t = TOPIC[it.topic] || TOPIC.Other;
  const m = MOOD[it.mood] || MOOD.neutral;
  return `
  <tr><td style="padding:11px 0;border-bottom:1px solid ${RULE};">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${META};font-weight:bold;padding-bottom:3px;">
      <span style="display:inline-block;width:8px;height:8px;background:${t.color};border-radius:2px;vertical-align:middle;"></span>
      &nbsp;${esc(it.company)}
    </div>
    <a href="${esc(it.url)}" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.32;font-weight:bold;color:${INK};text-decoration:none;">${esc(it.title)}</a>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.45;color:#5c5445;padding:3px 0 4px;">${esc(it.takeaway || '')}</div>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${META};">
      ${dot(m.color, 8)} <span style="vertical-align:middle;">${esc(m.label)}</span> &nbsp;·&nbsp; ${esc(it.source)} &nbsp;·&nbsp; ${esc(shortDate(it.date))}
    </div>
  </td></tr>`;
}

function sectionBlock(topic, list) {
  const t = TOPIC[topic] || TOPIC.Other;
  const stories = list.map(sectionStory).join('');
  return `
  <tr><td style="padding:20px 0 4px;">
    <span style="display:inline-block;background:${t.color};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;padding:4px 12px;">${esc(t.label)}</span>
  </td></tr>
  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${stories}</table></td></tr>`;
}

/**
 * Render the full newspaper email.
 * opts: { items, feeds, days, hour, unsubUrl, brandLogoUrl?, nowIso? }
 */
export function renderNewspaper(opts) {
  const { items = [], feeds = ['portfolio', 'watchlist'], days = 'weekdays', hour = 7, unsubUrl = '#', brandLogoUrl } = opts;
  const nowIso = opts.nowIso || new Date().toISOString();
  const edition = editionLabel(feeds);

  // Stats
  const total = items.length;
  const good = items.filter((i) => i.mood === 'positive').length;
  const bad = items.filter((i) => i.mood === 'negative').length;
  const topicCount = {};
  for (const i of items) topicCount[i.topic] = (topicCount[i.topic] || 0) + 1;
  const busiest = Object.entries(topicCount).sort((a, b) => b[1] - a[1])[0];
  const busiestLabel = busiest ? (TOPIC[busiest[0]] || TOPIC.Other).label : '—';

  // Front page = up to 3 most important (skip low); rest grouped by topic.
  const front = items.filter((i) => i.importance !== 'low').slice(0, 3);
  const frontIds = new Set(front.map((i) => i.id));
  const rest = items.filter((i) => !frontIds.has(i.id));
  const grouped = TOPIC_ORDER.map((t) => [t, rest.filter((i) => i.topic === t)]).filter(([, l]) => l.length);

  const masthead = brandLogoUrl
    ? `<img src="${esc(brandLogoUrl)}" alt="Munshot" height="34" style="display:block;margin:0 auto;">`
    : `<div style="font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:bold;letter-spacing:7px;color:${INK};padding-left:7px;">MUNSHOT</div>`;

  const emptyNote = `
  <tr><td style="padding:34px 0;text-align:center;">
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-style:italic;color:#4a4438;">Quiet day — nothing fundamental to report.</div>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${META};padding-top:8px;">We only email when there's real business news. See you tomorrow.</div>
  </td></tr>`;

  const body = total === 0
    ? emptyNote
    : `
    <tr><td style="padding:14px 0 2px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#4a4438;line-height:1.9;">
          ${dot('#94a3b8')} <b>${total}</b> ${total === 1 ? 'story' : 'stories'} &nbsp;&nbsp;
          ${dot('#10b981')} <b>${good}</b> good &nbsp;&nbsp;
          ${dot('#f43f5e')} <b>${bad}</b> watch-out${bad === 1 ? '' : 's'} &nbsp;&nbsp;
          <span style="color:${META};">busiest:</span> <b>${esc(busiestLabel)}</b>
        </td>
      </tr></table>
    </td></tr>
    ${front.length ? `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${front.map(frontStory).join('')}</table></td></tr>` : ''}
    ${grouped.map(([t, l]) => sectionBlock(t, l)).join('')}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Newsflow Daily Brief</title></head>
<body style="margin:0;padding:0;background:${CREAM};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(buildSubject(total, feeds, nowIso))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CREAM}" style="background:${CREAM};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;background:${PAPER};border:1px solid ${RULE};">

      <!-- MASTHEAD -->
      <tr><td style="padding:30px 34px 0;text-align:center;">
        ${masthead}
        <div style="border-top:3px double ${INK};margin:12px 0 7px;"></div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:4px;text-transform:uppercase;color:${META};">Newsflow — Daily Fundamental Brief</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;border-top:1px solid ${RULE};border-bottom:1px solid ${RULE};">
          <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:${META};padding:7px 0;text-align:center;text-transform:uppercase;">
            ${esc(fullDate(nowIso))} &nbsp;·&nbsp; Edition: ${esc(edition)}
          </td></tr>
        </table>
      </td></tr>

      <!-- CONTENT -->
      <tr><td style="padding:2px 34px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${body}
        </table>
      </td></tr>

      <!-- FOOTER -->
      <tr><td style="background:${INK};padding:22px 34px;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#d8d0be;">
          You're subscribed to <b style="color:#f2ead6;">${esc(edition)}</b>, ${esc(cadenceLabel(days))} at <b style="color:#f2ead6;">${esc(hourLabel(hour))} IST</b>.
        </div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;padding-top:8px;">
          <a href="${esc(unsubUrl)}" style="color:#e0b48c;text-decoration:underline;">Unsubscribe</a>
          <span style="color:#6b6455;">&nbsp;·&nbsp;</span>
          <span style="color:#a89f8b;">Powered by <b style="color:#e8dfca;letter-spacing:1px;">Munshot</b> · muns.io</span>
        </div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#6b6455;padding-top:10px;line-height:1.5;">
          Fundamental business news only — share-price noise removed. This brief is informational, not investment advice.
        </div>
      </td></tr>

    </table>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#a49b88;padding:12px 0 0;">Newsflow by Munshot</div>
  </td></tr>
</table>
</body></html>`;
}
