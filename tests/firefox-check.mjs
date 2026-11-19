// Firefox check (dev): load dist/firefox as a temporary add-on into Playwright's Firefox build
// (the same Remote Debugging Protocol call `web-ext run` uses), then drive real fixtures.
//   npm run build && node tests/firefox-check.mjs
// Note: Playwright's Firefox is a patched Firefox build, not the release you install; it runs
// the same WebExtensions code, which is what this checks.
import { firefox } from '@playwright/test';
import { connectWithMaxRetries, findFreeTcpPort } from '../node_modules/web-ext/lib/firefox/remote.js';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from './server.mjs';

const UUID = '7d2a6c9e-0b1f-4e5a-9c3d-0a0b0c0d0e0f';
const ID = 'oho@0khacha';
const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const port = await findFreeTcpPort();
const dir = mkdtempSync(path.join(os.tmpdir(), 'oho-ff-'));
const ctx = await firefox.launchPersistentContext(dir, {
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: ['-start-debugger-server', String(port)],
  firefoxUserPrefs: {
    'devtools.debugger.remote-enabled': true,
    'devtools.chrome.enabled': true,
    'devtools.debugger.prompt-connection': false,
    'xpinstall.signatures.required': false,
    // fixed internal UUID so the popup has a known moz-extension:// URL
    'extensions.webextensions.uuids': JSON.stringify({ [ID]: UUID }),
  },
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`);
};

try {
  const rdp = await connectWithMaxRetries({ port, maxRetries: 50, retryInterval: 200 });
  const res = await rdp.installTemporaryAddon(path.resolve('dist/firefox'));
  check('installTemporaryAddon', !!res?.addon?.id, res?.addon?.id);

  const state = (p) => p.evaluate(() => window.__oho);
  const popupUrl = `moz-extension://${UUID}/popup.html`;
  const page = await ctx.newPage();
  await page.goto(base + 'no-banner-article.html');

  for (const [fx, sel] of [['onetrust.html', '#onetrust-banner-sdk'], ['custom-fr.html', '#nb-42'], ['cookiebot.html', '#CybotCookiebotDialog']]) {
    const p = await ctx.newPage();
    await p.goto(base + fx);
    await p.waitForTimeout(fx === 'custom-fr.html' ? 4000 : 2500);
    const s = await state(p);
    const gone = !(await p.locator(sel).isVisible().catch(() => false));
    check(`reject ${fx}`, s?.result === 'rejected' && gone, `result=${s?.result} bannerGone=${gone} clicks=${JSON.stringify(s?.clicks)}`);
    await p.close();
  }

  // popup (extension page): Playwright's Firefox may refuse moz-extension:// navigation
  try {
    await page.goto(popupUrl, { waitUntil: 'commit', timeout: 10000 });
    await page.waitForTimeout(800);
    const granted = await page.evaluate(() => browser.permissions.contains({ origins: ['http://*/*', 'https://*/*'] }));
    const promptShown = await page.locator('#grant').isVisible();
    check('popup: Grant access prompt matches permission state', promptShown === !granted, `host access granted=${granted}, prompt visible=${promptShown}`);
    check('popup: counter', Number(await page.locator('#total-count').textContent()) >= 1, 'total=' + (await page.locator('#total-count').textContent()));
  } catch (e) {
    // Not a product failure: Playwright's Firefox build does not navigate to moz-extension:// pages.
    console.log(`skip popup checks (Grant access, counters): Playwright's Firefox cannot open moz-extension:// pages (${String(e).split('\n')[0].slice(0, 60)}). Check by hand with \`npm run firefox\`.`);
  }
} catch (e) {
  check('firefox run', false, String(e).split('\n')[0]);
} finally {
  await ctx.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
