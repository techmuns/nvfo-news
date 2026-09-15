# Newsflow

A colourful, visual-first news dashboard for an Indian equity family office. It
surfaces only **fundamental business news** about the companies you track —
orders, capex, mergers, approvals, fraud, and so on — with day-to-day
share-price noise stripped out. Every story is source-backed with a real link.

> **Status: Prompt 4 of 4 — complete.**
> Real news is scraped (Google News + **Valuepickr** forum + optional Munshot /
> Firecrawl), a **Claude (Bedrock)** step decides keep/drop and assigns topic,
> mood, importance, and a plain takeaway, and visitors can **subscribe** with
> their email + a day/time to receive a **Munshot-branded newspaper email
> digest** of their feeds — sent by an hourly Cloudflare **Cron Trigger**, with
> one-click unsubscribe. The add-keyword / add-stock boxes persist to Cloudflare
> **KV** via `/api/custom`. There is **no login**.
> Everything degrades gracefully: no Bedrock key → clean neutral interim; no
> Munshot email secrets → the digest just doesn't send. See `email-preview.html`
> for the exact email look.

---

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL — the dashboard loads immediately (no password).

| Script            | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `npm run dev`     | Start the Vite dev server                           |
| `npm run build`   | Type-check + build the static site into `dist/`     |
| `npm run preview` | Preview the production build locally                |
| `npm run deploy`  | Build and deploy to Cloudflare Workers via wrangler |

## Tech stack

- **React 18 + TypeScript + Vite**, **Tailwind CSS 3**, **Recharts**, **lucide-react**
- **Cloudflare Workers** (via `wrangler`) serve the built site (`/api/*` reserved for later)
- **Node ESM scrapers** (`/scrapers`) using Google News RSS + `fast-xml-parser`

## What you can do in the dashboard

- **Three feeds** (top-bar toggle): **Portfolio** (holdings), **Watchlist**
  (holdings + exited + anything you add), **Universe** (keyword-led global
  discovery).
- **Pulse** — newsflow over 14 days, topic donut, "most in the news", mood.
- **Feed** — the news as filterable/sortable cards (topic, company, source,
  mood, importance, search).
- **Filings** — NSE/BSE announcements, filterable by company and exchange.
- **+ Add** — custom keywords and watchlist stocks (localStorage for now).

## The data pipeline (`/scrapers`)

GitHub Actions runs the scrapers on a schedule and commits fresh JSON back to
`main`; the dashboard then reads `public/data/news.json` and
`public/data/filings.json`.

The pipeline order is **news → enrich → filings** (then commit → auto-deploy):

```bash
cd scrapers
npm install
node news.mjs                 # gather candidates -> ../public/data/news.json
node enrich.mjs               # Claude keeps/drops + tags (no-op without a key)
node filings.mjs              # Munshot filings -> ../public/data/filings.json
ENRICH_MOCK=1 node enrich.mjs # test the enrich pipeline locally, no Bedrock key
```

**News (`news.mjs`)** — for each tracked company (portfolio + watchlist, plus
any custom stocks from KV) one lightweight query per source:

- **Google News RSS** — the free, no-key backbone (always works).
- **Valuepickr forum** — the Discourse forum's JSON search, no key (opinion-heavy,
  so Claude keeps only the genuinely fundamental threads). Disable with `VALUEPICKR=0`.
- **Munshot news-search** — supplement, only if `MUNS_TOKEN` is set.
- **Firecrawl** — optional bonus publisher pass, only if `FIRECRAWL_API_KEY` is set.

Recall over precision: it keeps every item that **mentions the company** and
isn't caught by the **noise / data-SEO blocklist** — a literal keyword is only a
_hint_ (topic guess), not a hard gate, so Claude can catch fundamentals that
don't use the exact word ("blaze at plant" → Trouble). A wider **Universe** pass
runs theme + custom-keyword queries (incl. R32-style global stories).
_Fallback with no Bedrock key:_ it reverts to requiring a literal keyword so the
interim feed stays clean.

**Enrich (`enrich.mjs`) — the brain.** Sends each new item to **Claude on Amazon
Bedrock** (raw HTTPS with a Bedrock API key — no AWS SDK/SigV4) and decides
KEEP vs DROP, then sets `topic` (1 of 6 buckets), `mood`, `importance`, and a
plain `takeaway` (≤140 chars). Junk (price moves, broker ratings, "stocks to
watch", TradingView/simplywall.st data pages, "market size/CAGR" SEO) is dropped.
Only unenriched items are processed (cheap); missing a key is a safe no-op.

**Filings (`filings.mjs`)** — the Munshot filings endpoint (needs `MUNS_TOKEN` +
`MUNS_EMAIL`), mapped to friendly categories. If unavailable, the committed
`filings.json` is left untouched (never blanked).

**Safety rules:** every item has a real source URL; results are de-duped and
merged into the existing file (accumulate, keep ~45 days); a run that produces
zero items never blanks the file; existing enriched items are never re-clobbered.

### Environment variables (all optional)

| Var                 | Enables                                                    |
| ------------------- | --------------------------------------------------------- |
| `BEDROCK_API_KEY`   | The Claude enrichment brain (Bedrock bearer token)        |
| `BEDROCK_MODEL_ID`  | The Claude model / inference-profile id (Haiku 4.5 rec.)  |
| `AWS_REGION`        | Bedrock region (defaults to `us-east-1`)                  |
| `NEWSFLOW_URL`      | Deployed site URL — lets the scraper read custom KV lists |
| `MUNS_TOKEN`        | Munshot news + filings, and the email digest send         |
| `MUNS_EMAIL`        | Munshot filings + the email digest from-address           |
| `FIRECRAWL_API_KEY` | Firecrawl publisher pass (bonus)                          |
| `VALUEPICKR`        | set `0` to disable the Valuepickr source (on by default)  |

Google News needs no key, so the news scraper always produces data; without
`BEDROCK_*` the feed stays in the neutral interim state.

The Worker reads a few more (set as Worker vars/secrets in the Cloudflare
dashboard, not repo secrets): `MUNS_TOKEN` + `MUNS_EMAIL` + `MUNS_EMAIL_ENDPOINT`
(defaults to `https://fastapi.muns.io/tools/email-send`) enable the digest send;
`SITE_URL` is a fallback origin for unsubscribe links; `SEND_EMPTY=true` sends a
"quiet day" note when there's no news.

### Custom keywords / stocks (Cloudflare KV) — one-time setup

The add-boxes persist to KV via the Worker's `/api/custom` routes, and the
scraper merges them in. To turn it on **once** (then automatic forever):

```bash
npx wrangler kv namespace create NEWSFLOW_KV
```

Paste the printed id into the `[[kv_namespaces]]` block in `wrangler.toml` and
uncomment those three lines, then push. Add a `NEWSFLOW_URL` repo secret (your
deployed site URL) so the scraper reads the lists. Until configured, the boxes
fall back to `localStorage` and nothing breaks.

## Email digest (Prompt 4)

Visitors subscribe from the **Brief** button in the top bar (email + day/time +
feeds). The Worker stores each subscription in the same `NEWSFLOW_KV` under
`sub:<sha256(email)>`, and an **hourly Cloudflare Cron Trigger**
(`[triggers] crons = ["0 * * * *"]`) runs `scheduled()`:

- computes the current IST weekday + hour, finds subscriptions due now (day
  matches, at/after their chosen hour, not already sent today),
- reads `news.json` via the ASSETS binding, filters to the subscriber's feeds
  (enriched items preferred), takes the top ~14 by importance then recency,
- renders a **Munshot-branded newspaper email** (`worker/email.mjs` — masthead,
  by-the-numbers strip, a front page, topic sections in the dashboard's colours,
  a footer) and sends it via the Munshot Email API, then marks `lastSentDate` so
  it sends **once per day**. Every email has a one-click unsubscribe link
  (`GET /api/unsubscribe?token=…`).

`worker/email.mjs` is shared: `node scrapers/email-preview.mjs` writes
**`email-preview.html`** so the exact look can be reviewed in a browser
(`PREVIEW_FROM_LIVE=1` renders the committed feed instead of the sample).
Without the Munshot email secrets, everything still runs and just doesn't send.

## Deployment (Cloudflare Workers Builds — connected repo, automated forever)

The repo is connected to **Cloudflare Workers Builds**, so **every push to
`main` auto-deploys** — no GitHub secrets and no manual steps for deployment:

- Cloudflare runs `npx wrangler deploy`; the `[build]` hook in `wrangler.toml`
  builds the site first (`npm run build` → `dist/`), so nothing needs to be set
  as a "build command" in the dashboard.
- The Worker `name` in `wrangler.toml` (`newstracker`) matches the Cloudflare
  project.
- **`.github/workflows/refresh-news.yml`** — weekday mornings (07:01 IST) + on
  demand: runs **news → enrich → filings**, commits refreshed JSON to `main`;
  that push is picked up by Workers Builds and deployed. Optional secrets (repo →
  Settings → Secrets → Actions) enrich the pipeline: `BEDROCK_API_KEY`,
  `BEDROCK_MODEL_ID`, `AWS_REGION`, `NEWSFLOW_URL`, `MUNS_TOKEN`, `MUNS_EMAIL`,
  `FIRECRAWL_API_KEY`. Without them, Google News still populates the dashboard.

To deploy manually: `npm run deploy` (after `wrangler login`).

## Project structure

```
public/data/
  companies.json     tracked companies (portfolio + exited watchlist)
  keywords.json      the 30 base keywords + 6-bucket mapping
  news.json          scraped, keyword-matched news (envelope: generated_at, source, counts, items)
  filings.json       NSE/BSE filings (Munshot; sample until MUNS_* is set)
scrapers/
  news.mjs           Google News + Valuepickr + Munshot + Firecrawl -> news.json
  enrich.mjs         Claude (Bedrock) keep/drop + topic/mood/importance/takeaway
  filings.mjs        Munshot filings -> filings.json
  email-preview.mjs  writes ../email-preview.html from the shared renderer
  lib/util.mjs       fetch, RSS parse, keyword match, noise + data/SEO blocklist, merge
  lib/valuepickr.mjs Valuepickr Discourse forum search
  lib/firecrawl.mjs  optional publisher pass
src/
  lib/               types, theme, data layer, metrics, storage, format, api
  components/         TopBar, FeedToggle, Tabs, FilterBar, AddPanel, SubscribePanel, NewsCard, charts/, ui/
  pages/             Pulse.tsx, Feed.tsx, Filings.tsx
  App.tsx main.tsx index.css
worker/index.ts      Worker: serves dist/, /api/custom + /api/subscribe -> KV, scheduled() cron
worker/email.mjs     newspaper email renderer (shared with the preview script)
email-preview.html   saved preview of the newspaper email
.github/workflows/   refresh-news.yml (news -> enrich -> filings -> commit -> auto-deploy)
```

## Roadmap

- **Prompt 1:** full front-end on sample data. ✅
- **Prompt 2:** real scrapers → real `news.json` / `filings.json`; login removed. ✅
- **Prompt 3:** Claude (Bedrock) enrichment — noise-filter, topic, mood,
  importance, takeaway; Cloudflare KV "memory" for custom keywords/stocks. ✅
- **Prompt 4 (this):** Valuepickr forum source; email subscriptions + an hourly
  Cron Trigger sending a Munshot-branded newspaper digest with unsubscribe. ✅
