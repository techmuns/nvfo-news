// OPTIONAL Firecrawl supplement (Prompt 2 bonus).
// Only runs when FIRECRAWL_API_KEY is set. Scrapes a named publisher's search
// page and extracts headlines+links via Firecrawl's JSON mode. Entirely
// best-effort and non-fatal — Google News already covers these publishers, so
// this is a bonus, never a dependency. Any error yields [].

import { fetchWithTimeout, stripHtml, hostname } from './util.mjs';

// Keep it light: one named source, portfolio companies only (see news.mjs).
const SOURCES = [
  {
    name: 'Business Standard',
    url: (q) => `https://www.business-standard.com/search?q=${encodeURIComponent(q)}`,
  },
];

const SCHEMA = {
  type: 'object',
  properties: {
    articles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          date: { type: 'string' },
        },
        required: ['title', 'url'],
      },
    },
  },
  required: ['articles'],
};

let logged = false;

export async function firecrawlNews(company, apiKey) {
  if (!apiKey) return [];
  const out = [];
  for (const src of SOURCES) {
    try {
      const res = await fetchWithTimeout(
        'https://api.firecrawl.dev/v1/scrape',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            url: src.url(company.company),
            formats: ['json'],
            onlyMainContent: true,
            jsonOptions: {
              schema: SCHEMA,
              prompt: `Extract news article headlines about "${company.company}" with their absolute URLs and publish dates from this page.`,
            },
          }),
        },
        30000,
      );
      const raw = await res.json();
      if (!logged) {
        console.log('[firecrawl] sample raw:', JSON.stringify(raw).slice(0, 400));
        logged = true;
      }
      const articles = raw?.data?.json?.articles || raw?.json?.articles || [];
      for (const a of articles) {
        if (!a?.url || !a?.title) continue;
        let d = new Date(a.date || Date.now());
        if (isNaN(d.getTime())) d = new Date();
        out.push({
          title: stripHtml(a.title),
          link: a.url,
          date: d.toISOString(),
          source: src.name || hostname(a.url),
          snippet: '',
        });
      }
    } catch (e) {
      console.log(`[firecrawl] ${company.company} @ ${src.name}: ${e.message}`);
    }
  }
  return out;
}
