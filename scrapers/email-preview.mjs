// Generates ../email-preview.html from the newspaper renderer with realistic
// enriched sample data, so the exact email look can be reviewed in a browser.
//   node scrapers/email-preview.mjs
// (Pass a real ../public/data/news.json by setting PREVIEW_FROM_LIVE=1 to render
//  the committed feed instead of the sample below.)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderNewspaper, selectItems } from '../worker/email.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'email-preview.html');
const NEWS = path.resolve(__dirname, '..', 'public', 'data', 'news.json');

const SAMPLE = [
  { id: 's1', company: 'Menon Bearings', ticker: 'MENONBE', sector: 'Auto', scope: ['portfolio', 'watchlist'], topic: 'Growth', keyword: 'Commissioning', mood: 'positive', importance: 'high', enriched: true, source: 'Business Standard', date: '2026-09-03T09:15:00+05:30', title: 'Menon Bearings commissions new die-casting line at Kolhapur plant', url: 'https://www.business-standard.com/companies/news/menon-bearings-commissions-die-casting-line', takeaway: 'New line lifts capacity about 20% and targets rising export orders.' },
  { id: 's2', company: 'Sterlite Technologies', ticker: 'STLTECH', sector: 'Telecom', scope: ['portfolio', 'watchlist'], topic: 'Orders', keyword: 'Order', mood: 'positive', importance: 'high', enriched: true, source: 'Economic Times', date: '2026-09-02T18:40:00+05:30', title: 'Sterlite Technologies bags ₹1,850-crore optical-fibre order from a European telco', url: 'https://economictimes.indiatimes.com/markets/stocks/news/sterlite-technologies-order', takeaway: 'One of its largest overseas wins — adds roughly a year of extra work.' },
  { id: 's3', company: 'Senores Pharmaceuticals', ticker: 'SENORES', sector: 'Healthcare', scope: ['portfolio', 'watchlist'], topic: 'Approvals&IP', keyword: 'Approval', mood: 'positive', importance: 'high', enriched: true, source: 'Mint', date: '2026-09-02T11:05:00+05:30', title: 'Senores Pharma gets US FDA nod for its Baddi injectables facility', url: 'https://www.livemint.com/companies/news/senores-pharma-usfda-baddi', takeaway: 'Clears the way to sell more products in the US, its biggest market.' },
  { id: 's4', company: 'Epigral', ticker: 'EPIGRAL', sector: 'Chemicals', scope: ['portfolio', 'watchlist'], topic: 'Growth', keyword: 'Capex', mood: 'positive', importance: 'medium', enriched: true, source: 'moneycontrol', date: '2026-09-01T10:20:00+05:30', title: 'Epigral to invest ₹800 crore in new chlor-alkali and derivatives capacity', url: 'https://www.moneycontrol.com/news/business/epigral-capex', takeaway: 'Bigger plants should support higher sales over the next two years.' },
  { id: 's5', company: 'Stylam Industries', ticker: 'STYLAMIND', sector: 'Consumer Durables', scope: ['portfolio', 'watchlist'], topic: 'Growth', keyword: 'Capacity Expansion', mood: 'positive', importance: 'medium', enriched: true, source: 'Business Standard', date: '2026-08-31T13:30:00+05:30', title: 'Stylam Industries expands laminate capacity by 40% at Panchkula', url: 'https://www.business-standard.com/companies/news/stylam-capacity', takeaway: 'More output to meet growing furniture and export demand.' },
  { id: 's6', company: 'Saregama India', ticker: 'SAREGAMA', sector: 'Media', scope: ['portfolio', 'watchlist'], topic: 'Deals', keyword: 'Acquisition', mood: 'positive', importance: 'medium', enriched: true, source: 'Mint', date: '2026-09-01T12:00:00+05:30', title: 'Saregama acquires majority stake in a regional music label for ₹250 crore', url: 'https://www.livemint.com/companies/news/saregama-acquisition', takeaway: 'Adds a large song catalogue that can earn royalties for years.' },
  { id: 's7', company: 'Menon Bearings', ticker: 'MENONBE', sector: 'Auto', scope: ['portfolio', 'watchlist'], topic: 'Deals', keyword: 'Partnership', mood: 'neutral', importance: 'low', enriched: true, source: 'Valuepickr', date: '2026-08-30T20:10:00+05:30', title: 'Menon Bearings — capex, exports and the die-casting opportunity (thread)', url: 'https://forum.valuepickr.com/t/menon-bearings/1234', takeaway: 'Forum members weigh the new capex against export demand and margins.' },
  { id: 's8', company: 'Cartrade Tech', ticker: 'CARTRADE', sector: 'Consumer Services', scope: ['portfolio', 'watchlist'], topic: 'Money', keyword: 'Earnings', mood: 'positive', importance: 'medium', enriched: true, source: 'Economic Times', date: '2026-08-31T17:10:00+05:30', title: 'CarTrade Tech Q1 profit doubles as used-car platform scales', url: 'https://economictimes.indiatimes.com/markets/stocks/earnings/cartrade-q1', takeaway: 'Profit jumped as more buyers and sellers used its car marketplace.' },
  { id: 's9', company: 'Sterlite Technologies', ticker: 'STLTECH', sector: 'Telecom', scope: ['portfolio', 'watchlist'], topic: 'Money', keyword: 'QIP', mood: 'neutral', importance: 'medium', enriched: true, source: 'Economic Times', date: '2026-08-31T19:05:00+05:30', title: 'Sterlite Technologies board approves ₹1,000-crore fundraise via QIP', url: 'https://economictimes.indiatimes.com/markets/stocks/news/sterlite-qip', takeaway: 'Raising money from big investors to cut debt and fund growth.' },
  { id: 's10', company: 'Venus Remedies', ticker: 'VENUSREM', sector: 'Healthcare', scope: ['portfolio', 'watchlist'], topic: 'Approvals&IP', keyword: 'Patent', mood: 'positive', importance: 'medium', enriched: true, source: 'Mint', date: '2026-08-30T10:00:00+05:30', title: 'Venus Remedies granted a patent for an antibiotic formulation in Europe', url: 'https://www.livemint.com/companies/news/venus-remedies-patent', takeaway: 'Patent protects a product and can open licensing deals abroad.' },
  { id: 's11', company: 'Omnitech Engineering', ticker: 'OMNI', sector: 'Capital Goods', scope: ['portfolio', 'watchlist'], topic: 'Trouble', keyword: 'Resignation', mood: 'negative', importance: 'medium', enriched: true, source: 'moneycontrol', date: '2026-08-31T19:30:00+05:30', title: 'Omnitech Engineering CFO resigns citing personal reasons', url: 'https://www.moneycontrol.com/news/business/omnitech-cfo-resigns', takeaway: 'A senior finance exit investors will watch for stability.' },
  { id: 's12', company: 'TANFAC Industries', ticker: 'TANFACIND', sector: 'Chemicals', scope: ['portfolio', 'watchlist'], topic: 'Trouble', keyword: 'Fire', mood: 'negative', importance: 'low', enriched: true, source: 'moneycontrol', date: '2026-08-30T08:30:00+05:30', title: "Minor fire at TANFAC's Cuddalore unit; no injuries reported", url: 'https://www.moneycontrol.com/news/business/tanfac-fire', takeaway: 'Small fire, quickly controlled; limited impact on operations.' },
];

function loadItems() {
  if (process.env.PREVIEW_FROM_LIVE === '1') {
    try {
      const d = JSON.parse(fs.readFileSync(NEWS, 'utf8'));
      const picked = selectItems(d.items || [], ['portfolio', 'watchlist'], 14);
      if (picked.length) return picked;
    } catch {
      /* fall through to sample */
    }
  }
  return SAMPLE;
}

const items = loadItems();
const html = renderNewspaper({
  items,
  feeds: ['portfolio', 'watchlist'],
  days: 'weekdays',
  hour: 7,
  unsubUrl: 'https://newstracker.example/api/unsubscribe?token=demo-token',
  nowIso: '2026-09-03T07:00:00+05:30',
});

fs.writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${items.length} items, ${html.length} bytes)`);
