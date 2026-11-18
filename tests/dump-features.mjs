// Runs the dev collector (training/collector.js) over every fixture in automatic-label mode
// and writes training/data/fixtures.csv: a small seed dataset to exercise training/train.py.
// Real training data should come from the collector bookmarklet on real sites.
//
//   npm run build:collector && node tests/dump-features.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { start } from './server.mjs';

// Ground truth for the fixtures: these elements are cookie banners, everything else is not.
const BANNERS = [
  '#onetrust-consent-sdk', '#onetrust-banner-sdk', '#onetrust-pc-sdk', '#CybotCookiebotDialog', '#didomi-notice',
  '#qc-cmp2-ui', '#truste-consent-track', '#usercentrics-root', '#axeptio_overlay', '.axeptio_widget',
  '#iubenda-cs-banner', '.cmplz-cookiebanner', '#nb-42', '#x7', '#dlg', '#pnl', '#sp_message_container_1042',
].join(',');

const fixtures = readdirSync(new URL('./fixtures/', import.meta.url)).filter((f) => f.endsWith('.html') && !f.startsWith('_') && !f.endsWith('-frame.html'));
const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
let header = '';
const rows = [];
for (const fx of fixtures) {
  const page = await browser.newPage();
  await page.goto(base + fx, { waitUntil: 'load' });
  await page.waitForTimeout(1600); // late banners
  await page.evaluate((sel) => {
    window.__ohoAutoLabel = (el) => (el.matches(sel) || el.querySelector(sel) ? 1 : 0);
  }, BANNERS);
  await page.addScriptTag({ path: 'training/collector.js' });
  const out = await page.evaluate(() => window.ohoCollector.rows());
  header = out[0];
  rows.push(...out.slice(1));
  await page.close();
}
await browser.close();
server.close();
mkdirSync('training/data', { recursive: true });
writeFileSync('training/data/fixtures.csv', [header, ...rows].join('\n') + '\n');
console.log(`training/data/fixtures.csv: ${rows.length} rows (${rows.filter((r) => /,1,"/.test(r)).length} banners)`);
