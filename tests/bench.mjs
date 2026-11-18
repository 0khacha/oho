// Per-page execution-time benchmark. Fails if oho spends > 10 ms of main-thread work on any fixture.
//
// Uses the instrumented bundle from `node scripts/build.mjs --bench` (dist/bench): every synchronous
// slice of oho's work (script evaluation, scans, flow steps, the lazy fallback) is wrapped in a timer
// and summed into window.__ohoBench.ms. Waiting (timers, storage, module fetch) is not work and is
// not counted. Content scripts are injected after `load`, like document_idle.
//
//   node tests/bench.mjs [--runs 5] [--throttle 4]
import { chromium } from '@playwright/test';
import { readdirSync, writeFileSync } from 'node:fs';
import { start } from './server.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const RUNS = arg('--runs', 5);
const THROTTLE = arg('--throttle', 1);
const BUDGET_MS = 10;
const SETTLE_MS = 5000; // covers late banners, the 3 s full rescan, multi-step flows and the 1.5 s post-click check

const fixtures = readdirSync(new URL('./fixtures/', import.meta.url))
  .filter((f) => f.endsWith('.html') && !f.startsWith('_') && !f.endsWith('-frame.html'))
  .sort();

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const ctx = await browser.newContext();

// Stand-in for the extension APIs (the bench runs oho as plain page scripts).
await ctx.addInitScript(() => {
  const store = { get: async () => ({}), set: async () => {}, remove: async () => {} };
  Object.defineProperty(window, 'chrome', {
    configurable: true,
    value: {
      runtime: { getURL: (p) => location.origin + '/__oho/' + p, sendMessage: async () => true },
      storage: { local: store, session: store },
    },
  });
});

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const rows = [];
let failed = false;

for (const fx of fixtures) {
  const times = [];
  let result = null;
  for (let r = 0; r < RUNS; r++) {
    const page = await ctx.newPage();
    if (THROTTLE > 1) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    }
    await page.goto(base + fx, { waitUntil: 'load' });
    await page.addScriptTag({ url: '/__oho/api.js' });
    await page.addScriptTag({ url: '/__oho/content.js' });
    await page.waitForTimeout(SETTLE_MS);
    const b = await page.evaluate(() => ({ bench: window.__ohoBench, oho: window.__oho }));
    times.push(b.bench?.ms ?? 0);
    const marked = await page.locator('[data-oho-handled=hidden]').count();
    result = b.oho?.result ?? (marked ? 'hidden' : '-');
    await page.close();
  }
  const row = { fixture: fx.replace('.html', ''), median: median(times), max: Math.max(...times), result };
  if (row.max > BUDGET_MS) failed = true;
  rows.push(row);
}

await browser.close();
server.close();

const pad = (s, n) => String(s).padEnd(n);
const lines = [
  `oho bench: ${RUNS} runs/fixture, CPU throttle ${THROTTLE}x, budget ${BUDGET_MS} ms`,
  `${pad('fixture', 20)}${pad('median ms', 11)}${pad('max ms', 9)}outcome`,
  ...rows.map((r) => `${pad(r.fixture, 20)}${pad(r.median.toFixed(2), 11)}${pad(r.max.toFixed(2), 9)}${r.result}`),
];
console.log(lines.join('\n'));
writeFileSync(new URL(`../bench-results${THROTTLE > 1 ? `-x${THROTTLE}` : ''}.txt`, import.meta.url), lines.join('\n') + '\n');
if (failed) {
  console.error(`\nFAIL: at least one fixture exceeded ${BUDGET_MS} ms`);
  process.exit(1);
}
console.log(`\nPASS: every fixture under ${BUDGET_MS} ms`);
