// Dev-only: record assets/demo.gif (before/after on fixtures) and the 1280x800 store screenshots.
//   npm run build && node tests/record-demo.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from './server.mjs';
import { decodePNG, downscale, encodeGIF } from '../scripts/gif.mjs';

const EXT = path.resolve('dist/chrome');
const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const W = 1280, H = 800;

async function launch(withOho) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oho-demo-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium', headless: true, viewport: { width: W, height: H },
    args: withOho ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [],
  });
  return { ctx, dir };
}

/** Caption strip drawn into the page for the recording only (not part of oho). */
const caption = (page, text, ok) =>
  page.evaluate(([text, ok]) => {
    document.getElementById('__demo_cap')?.remove();
    const d = document.createElement('div');
    d.id = '__demo_cap';
    d.textContent = text;
    d.style.cssText = `position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;font:600 22px system-ui,sans-serif;padding:10px 20px;border-radius:999px;color:#fff;background:${ok ? '#15803d' : '#c2410c'};box-shadow:0 4px 16px #0004`;
    document.documentElement.appendChild(d);
  }, [text, ok]);

const SCENES = [
  { fx: 'onetrust.html', before: 'OneTrust banner', after: 'oho: "Reject All" clicked' },
  { fx: 'custom-fr.html', before: 'Unknown banner (FR)', after: 'oho: "Continuer sans accepter"', wait: 1600 },
  { fx: 'custom-ar.html', before: 'Unknown banner (AR)', after: 'oho: "رفض الكل" clicked' },
];

const before = await launch(false);
const after = await launch(true);
const frames = [];
const shots = {};
for (const s of SCENES) {
  const p1 = await before.ctx.newPage();
  await p1.goto(base + s.fx);
  await p1.waitForTimeout(s.wait ?? 400);
  await caption(p1, s.before, false);
  const b = await p1.screenshot();
  await p1.close();
  const p2 = await after.ctx.newPage();
  await p2.goto(base + s.fx);
  await p2.waitForTimeout((s.wait ?? 0) + 2200);
  await caption(p2, s.after, true);
  const a = await p2.screenshot();
  await p2.close();
  shots[s.fx] = { b, a };
  frames.push({ img: downscale(decodePNG(b), 2), delayMs: 1600 }, { img: downscale(decodePNG(a), 2), delayMs: 1900 });
}
mkdirSync('assets', { recursive: true });
writeFileSync('assets/demo.gif', encodeGIF(frames));
const kb = statSync('assets/demo.gif').size / 1024;
console.log(`assets/demo.gif: ${kb.toFixed(0)} KB, ${frames.length} frames`);
if (kb > 2048) throw new Error('demo.gif exceeds 2 MB');

// ---- store screenshots (1280x800) ----
mkdirSync('store/screenshots', { recursive: true });
writeFileSync('store/screenshots/1-before.png', shots['onetrust.html'].b);
writeFileSync('store/screenshots/2-after.png', shots['onetrust.html'].a);

// popup: render it at 2x, then place it on a 1280x800 canvas next to the "after" page
const sw = after.ctx.serviceWorkers()[0] ?? (await after.ctx.waitForEvent('serviceworker'));
const id = new URL(sw.url()).host;
const pop = await after.ctx.newPage({ deviceScaleFactor: 2 });
await pop.setViewportSize({ width: 312, height: 560 });
await pop.goto(`chrome-extension://${id}/popup.html`);
// Stage what the popup shows right after a rejection on the current tab (the popup page is its
// own active tab here, so seed its per-tab counter and outcome), then reload it.
await pop.evaluate(async () => {
  const t = await chrome.tabs.getCurrent();
  await chrome.storage.session.set({ [`oho_tab_${t.id}`]: 1, [`oho_last_${t.id}`]: { id: 'onetrust', how: 'rejected', t: Date.now() } });
});
await pop.reload();
await pop.waitForTimeout(400);
const popPng = await pop.locator('body').screenshot();
await pop.close();
const canvas = await after.ctx.newPage();
await canvas.setContent(`<body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;background:linear-gradient(135deg,#1d1b18 0%,#3a1608 100%);font-family:system-ui,'Segoe UI',sans-serif">
  <div style="position:absolute;left:96px;top:200px;width:560px;color:#fff">
    <svg viewBox="0 0 156 64" width="195" height="80" aria-label="oho"><g fill="none" stroke="#fb923c" stroke-width="8" stroke-linecap="round"><circle cx="28" cy="38" r="18"/><path d="M15.3 25.3 L40.7 50.7"/><path d="M64 10 V56 M64 38 a14 14 0 0 1 28 0 V56"/><circle cx="124" cy="38" r="18"/></g></svg>
    <div style="font:700 50px/1.1 system-ui;margin-top:28px;letter-spacing:-.01em">Says no to cookie banners, for you.</div>
    <div style="font:400 22px/1.45 system-ui;margin-top:20px;color:#e7ded3">Clicks "Reject all", or switches every optional purpose off and saves. Never accepts.</div>
    <div style="font:500 18px/1.4 system-ui;margin-top:28px;color:#fdba74">18 KB · runs locally · zero network requests</div>
  </div>
  <img src="data:image/png;base64,${popPng.toString('base64')}" style="position:absolute;right:120px;top:120px;width:312px;border-radius:14px;box-shadow:0 24px 60px #000a">
</body>`);
await canvas.screenshot({ path: 'store/screenshots/3-popup.png' });
console.log('store/screenshots: 1-before.png, 2-after.png, 3-popup.png');

for (const c of [before, after]) { await c.ctx.close(); rmSync(c.dir, { recursive: true, force: true }); }
server.close();
