// Dev-only: Chrome Web Store assets, rendered from assets/*.svg with headless Chromium.
//   npm run store-assets        -> store/chrome/icon-128.png, store/chrome/promo-small.png
//   node tests/store-assets.mjs --out <dir>
// Store icon (Chrome guidelines): 128x128, the artwork in the central 96x96, 16 px transparent padding.
// It uses assets/mark.svg, the same square mark as the extension's own icons (the wide wordmark in
// assets/logo.svg would fill only ~87x34 px of that box).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const OUT = arg('--out', 'store/chrome');
mkdirSync(OUT, { recursive: true });

const svg = (f) => readFileSync(`assets/${f}.svg`, 'utf8').replace(/<\?xml[^>]*>/, '');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });

// ---- icon-128.png: 96x96 artwork box, centered, 16 px transparent padding ----
await page.setViewportSize({ width: 128, height: 128 });
await page.setContent(`<html><body style="margin:0;background:transparent">
  <div style="position:absolute;left:16px;top:16px;width:96px;height:96px;display:flex;align-items:center;justify-content:center">
    ${svg('mark').replace(/width="\d+" height="\d+"/, 'style="max-width:96px;max-height:96px;width:100%;height:auto"')}
  </div></body></html>`);
await page.screenshot({ path: path.join(OUT, 'icon-128.png'), omitBackground: true });

// ---- promo-small.png: 440x280 small promo tile ----
await page.setViewportSize({ width: 440, height: 280 });
const wordmark = svg('logo').replace(/stroke="#c2410c"/, 'stroke="#fb923c"').replace(/width="\d+" height="\d+"/, 'width="137" height="56"');
const mark = svg('mark').replace(/width="\d+" height="\d+"/, 'width="72" height="72"');
await page.setContent(`<html><body style="margin:0;width:440px;height:280px;overflow:hidden;
  background:linear-gradient(135deg,#1d1b18 0%,#3a1608 100%);font-family:system-ui,'Segoe UI',sans-serif;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:#fff">
  <div style="display:flex;align-items:center;gap:20px">${mark}${wordmark}</div>
  <div style="font:600 24px/1.2 system-ui,'Segoe UI',sans-serif;letter-spacing:-.01em;text-align:center">Says no to cookie banners for you</div>
</body></html>`);
await page.screenshot({ path: path.join(OUT, 'promo-small.png') });

await browser.close();
console.log(`${OUT}: icon-128.png (from assets/mark.svg), promo-small.png`);
