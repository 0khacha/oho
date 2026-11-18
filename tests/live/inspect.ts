// Debug one live site: load it (with or without oho), wait, evaluate expressions, take a screenshot.
//
//   node tests/live/inspect.ts <url> [--no-oho] [--wait 8000] [--eval "<js expr>"]... [--frames] [--headed]
// Each --eval is evaluated in the page (as an async function body if it contains "return").
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LIVE, ROOT, UA, cliArgs } from './lib.ts';

const argv = process.argv.slice(2);
const url = argv[0]!;
const args = cliArgs(argv);
const evals: string[] = [];
argv.forEach((a, i) => a === '--eval' && evals.push(argv[i + 1]!));
const wait = Number(argv[argv.indexOf('--wait') + 1] || 0) || 8000;
const oho = !argv.includes('--no-oho');
const EXT = path.join(ROOT, 'dist', 'chrome');
const dir = mkdtempSync(path.join(os.tmpdir(), 'oho-inspect-'));
const ctx = await chromium.launchPersistentContext(dir, {
  channel: 'chromium', headless: !args.headed, userAgent: UA, viewport: { width: 1280, height: 800 },
  proxy: args.proxy ? { server: args.proxy } : undefined,
  args: oho ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [],
});
const page = await ctx.newPage();
page.on('console', (m) => (m.type() === 'error' || m.text().startsWith('[oho')) && console.log('console:', m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.waitForTimeout(wait);
for (const e of evals) {
  const body = e.includes('return') ? e : `return (${e})`;
  for (const f of argv.includes('--frames') ? page.frames() : [page.mainFrame()]) {
    const v = await f.evaluate(`(async () => { ${body} })()`).catch((err) => 'ERR ' + String(err).split('\n')[0]);
    console.log(`[${f === page.mainFrame() ? 'top' : f.url().slice(0, 70)}] ${e.slice(0, 60)} =>`, typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  }
}
await page.screenshot({ path: path.join(LIVE, 'inspect.png') }).catch(() => {});
await ctx.close();
rmSync(dir, { recursive: true, force: true });
