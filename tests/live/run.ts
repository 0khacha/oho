// Live test: run oho on real websites and verify the refusal was actually recorded.
// Deliberately NOT part of `npm run check` (network, geo-targeting, flaky by nature).
//
//   npm run build && node tests/live/run.ts [--headed] [--proxy http://host:port] [--only <host-substring>] [--concurrency 3]
//
// Per site:
//   A. fresh profile WITHOUT oho: does a banner appear? -> before.png (or NOT SHOWN)
//   B. fresh profile WITH oho: wait for oho's outcome (15 s max) -> after.png; record every click,
//      check scroll/overlay, read TCF + the CMP's own stored choice
//   C. disable oho, reload: the banner must not come back -> reload.png
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LIVE, ROOT, UA, bannerProbe, botWallProbe, cliArgs, consentProbe, detectCmps, isAcceptClick, layoutProbe, slug,
  type Check, type Site,
} from './lib.ts';

type Result = 'PASS' | 'HIDDEN' | 'WALL' | 'MISS' | 'FAIL' | 'NOT SHOWN' | 'ERROR';
interface Row {
  site: string; url: string; cmp: string; lang: string; result: Result; ms: number | null;
  oho: string; notes: string[]; checks: Check[]; clicks: string[]; apis?: Record<string, string>;
}

const args = cliArgs();
const EXT = path.join(ROOT, 'dist', 'chrome');
const rules = JSON.parse(readFileSync(path.join(ROOT, 'rules', 'cmps.json'), 'utf8')).cmps;
const { sites } = JSON.parse(readFileSync(path.join(LIVE, 'sites.json'), 'utf8')) as { sites: Site[] };
const todo = args.only ? sites.filter((s) => s.url.includes(args.only!)) : sites;
const OHO_WAIT_MS = 15_000;

const locale = (lang: string): string => (lang === 'ar' ? 'ar-MA' : `${lang}-${lang.toUpperCase()}`);

async function launch(withOho: boolean, lang: string): Promise<{ ctx: BrowserContext; dir: string }> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oho-live-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: !args.headed,
    userAgent: UA,
    locale: locale(lang),
    viewport: { width: 1280, height: 800 },
    proxy: args.proxy ? { server: args.proxy } : undefined,
    args: withOho ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [],
  });
  return { ctx, dir };
}

async function close(c: { ctx: BrowserContext; dir: string }): Promise<void> {
  await c.ctx.close().catch(() => {});
  rmSync(c.dir, { recursive: true, force: true, maxRetries: 3 });
}

async function shot(page: Page, file: string, row: Row): Promise<void> {
  await page.screenshot({ path: file, timeout: 10_000, animations: 'disabled' }).catch((e) => row.notes.push(`screenshot ${path.basename(file)} failed: ${String(e).split('\n')[0]!.slice(0, 60)}`));
}

async function waitBanner(page: Page, ms: number): Promise<{ visible: boolean; by: string }> {
  const end = Date.now() + ms;
  let b = { visible: false, by: '' };
  while (Date.now() < end) {
    b = await page.evaluate(bannerProbe, rules).catch(() => b);
    if (b.visible) return b;
    await page.waitForTimeout(500);
  }
  return b;
}

/** Records every click (in every frame), with the real target behind shadow roots. */
function recordClicks(): void {
  const w = window as unknown as { __ohoClicks: string[] };
  w.__ohoClicks = [];
  document.addEventListener(
    'click',
    (e) => {
      const t = (e.composedPath()[0] ?? e.target) as HTMLElement;
      const b = (t.closest?.('button,a,[role=button],input,label') ?? t) as HTMLElement & { value?: string };
      const label = [b.innerText || b.textContent || '', b.getAttribute?.('aria-label') ?? '', b.value ?? '', b.getAttribute?.('title') ?? '']
        .join(' ').replace(/\s+/g, ' ').trim().slice(0, 100);
      w.__ohoClicks.push(label || `<${b.tagName?.toLowerCase()}#${b.id}>`);
    },
    true,
  );
}

async function clicks(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (const f of page.frames()) out.push(...(await f.evaluate(() => (window as any).__ohoClicks ?? []).catch(() => [])));
  return out;
}

async function ohoOutcome(sw: Worker): Promise<{ id: string; how: string; t: number } | null> {
  return sw.evaluate(async () => {
    const all = await chrome.storage.session.get(null);
    const k = Object.keys(all).find((x) => x.startsWith('oho_last_'));
    return k ? (all[k] as { id: string; how: string; t: number }) : null;
  });
}

async function runSite(site: Site): Promise<Row> {
  const name = slug(site.url);
  const dir = path.join(LIVE, 'results', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const row: Row = { site: name, url: site.url, cmp: site.cmp + (site.other ? `:${site.other}` : ''), lang: site.lang, result: 'ERROR', ms: null, oho: '-', notes: [], checks: [], clicks: [] };

  // ---- A: without oho ----
  const a = await launch(false, site.lang);
  let shown = { visible: false, by: '' };
  try {
    const p = await a.ctx.newPage();
    await p.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    shown = await waitBanner(p, 12_000);
    await p.waitForTimeout(500);
    await shot(p, path.join(dir, 'before.png'), row);
  } catch (e) {
    row.notes.push('before: ' + String(e).split('\n')[0]);
  } finally {
    await close(a);
  }

  // ---- B: with oho ----
  const b = await launch(true, site.lang);
  try {
    const sw = b.ctx.serviceWorkers()[0] ?? (await b.ctx.waitForEvent('serviceworker', { timeout: 10_000 }));
    await b.ctx.addInitScript(recordClicks);
    const page = await b.ctx.newPage();
    const t0 = Date.now();
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    let out = null;
    let firstSeen = 0; // when a banner first became visible in this pass (diagnostics)
    while (!out && Date.now() - t0 < OHO_WAIT_MS) {
      await page.waitForTimeout(250);
      out = await ohoOutcome(sw);
      if (!firstSeen && (await page.evaluate(bannerProbe, rules).catch(() => ({ visible: false }))).visible) firstSeen = Date.now() - t0;
    }
    if (!out) {
      // Diagnose a miss: did oho act after the window, and when did the banner even appear?
      const lateEnd = Date.now() + 20_000;
      while (!out && Date.now() < lateEnd) {
        await page.waitForTimeout(500);
        out = await ohoOutcome(sw);
      }
      row.notes.push(`diagnostic: banner first visible at ${firstSeen ? firstSeen + ' ms' : 'never (in this pass)'}; ` +
        (out ? `oho acted LATE, at ${out.t - t0} ms (outside the ${OHO_WAIT_MS / 1000} s window)` : 'oho never acted (35 s)'));
      if (out) out = null; // still a miss under the 15 s rule
    }
    const neverShownWithOho = !out && !firstSeen;
    row.ms = out ? out.t - t0 : null;
    row.oho = out ? `${out.how} (${out.id})` : 'nothing';
    await page.waitForTimeout(out ? 3000 : 1000); // let the CMP persist its choice and close
    await shot(page, path.join(dir, 'after.png'), row);

    const after = await page.evaluate(bannerProbe, rules).catch(() => ({ visible: false, by: '' }));
    const layout = await page.evaluate(layoutProbe).catch(() => null);
    row.clicks = await clicks(page);
    const cmpForChecks = site.cmp === 'custom' ? 'custom' : site.cmp;
    row.checks = await page.evaluate(consentProbe, cmpForChecks).catch((e) => [{ name: 'probe', ok: null, detail: String(e).slice(0, 120) }]);
    row.apis = (await page.evaluate(detectCmps).catch(() => null))?.apis;

    // ---- C: reload with oho disabled: did the choice stick? ----
    let back = { visible: false, by: '' };
    let reloadChecks: Check[] = [];
    if (out) {
      await sw.evaluate(() => chrome.storage.local.set({ oho_settings: { enabled: false, disabledSites: [] } }));
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
      // Some CMPs flash their dialog for a moment while reading the stored choice: only a banner
      // that is still there at the end of the window counts as "came back".
      await page.waitForTimeout(7000);
      const b1 = await page.evaluate(bannerProbe, rules).catch(() => back);
      await page.waitForTimeout(1500);
      const b2 = await page.evaluate(bannerProbe, rules).catch(() => back);
      back = b1.visible && b2.visible ? b2 : { visible: false, by: '' };
      await shot(page, path.join(dir, 'reload.png'), row);
      if (back.visible) {
        // Is the refusal still stored? Then the site is reacting to it (e.g. a pay-or-accept wall
        // "you refused cookies: accept or subscribe"), which is not a lost choice.
        reloadChecks = await page.evaluate(consentProbe, site.cmp).catch(() => []);
      }
    }

    // ---- classify ----
    const blocked = await page.evaluate(botWallProbe).catch(() => false);
    const accepted = row.clicks.filter(isAcceptClick);
    const failedChecks = row.checks.filter((c) => c.ok === false);
    const broken = layout && (!layout.scrollable || layout.covered) && !layout.siteModal;
    if (layout && (!layout.scrollable || layout.covered) && layout.siteModal) row.notes.push(`scroll locked by the site's own modal ("${layout.siteModal}"), not a cookie banner`);
    if (accepted.length) {
      row.result = 'FAIL';
      row.notes.push('ACCEPT CLICKED: ' + accepted.join(' | '));
    } else if (out?.how === 'wall') {
      row.result = 'WALL';
      row.notes.push('pay-or-accept wall (only refusal is paying): left alone, "Hide pay-or-accept walls" is off');
    } else if (blocked && !out) {
      row.result = 'ERROR';
      row.notes.push('blocked by bot protection / captcha (try --headed or a residential/EU proxy)');
    } else if (!shown.visible && !out && !after.visible) {
      row.result = 'NOT SHOWN';
      row.notes.push('no banner appeared in either pass (CMPs often show banners to EU/EEA visitors only)');
    } else if (neverShownWithOho && !after.visible) {
      row.result = 'NOT SHOWN';
      row.notes.push('banner appeared without oho but never in the oho pass: nothing to reject (the CMP did not render it)');
    } else if (after.visible) {
      row.result = 'MISS';
      row.notes.push(`banner still visible (${after.by})`);
    } else if (!out) {
      row.result = 'MISS';
      row.notes.push(`banner was shown (${shown.by}) but oho reported nothing`);
    } else if (broken) {
      row.result = 'FAIL';
      row.notes.push(`page broken after oho: scrollable=${layout!.scrollable} lock=${layout!.lock} covered=${layout!.covered || '-'}`);
    } else if (out.how === 'hidden') {
      row.result = 'HIDDEN';
      if (back.visible) row.notes.push('banner returns on reload (expected: nothing was refused)');
    } else if (failedChecks.length) {
      row.result = 'FAIL';
      row.notes.push('refusal not recorded: ' + failedChecks.map((c) => `${c.name}: ${c.detail}`).join('; '));
    } else if (back.visible && reloadChecks.some((c) => c.ok === true) && !reloadChecks.some((c) => c.ok === false)) {
      row.result = 'PASS';
      row.notes.push(`refusal still stored after reload, but the site shows a dialog again (${back.by}): typically "you refused: accept or subscribe"`);
    } else if (back.visible) {
      row.result = 'MISS';
      row.notes.push(`banner came back after reload (${back.by}): choice not saved`);
    } else {
      row.result = 'PASS';
      if (!row.checks.some((c) => c.ok === true)) row.notes.push('no consent store to verify; reload check passed');
    }
    if (!shown.visible && out) row.notes.push('banner not seen in the no-oho pass (timing/geo)');
    for (const c of row.checks) if (c.ok !== false) row.notes.push(`${c.name}${c.ok === null ? ' (n/a)' : ' ok'}: ${c.detail}`);
    if (layout?.lock && !broken) row.notes.push('html/body overflow:hidden but page still scrolls');
  } catch (e) {
    row.result = 'ERROR';
    row.notes.push(String(e).split('\n')[0]!);
  } finally {
    await close(b);
  }
  writeFileSync(path.join(dir, 'result.json'), JSON.stringify(row, null, 2));
  return row;
}

// The network on a live run is hostile (resets, half-closed sockets): never let one site kill the run.
const firstLine = (e: unknown): string => String(e).split('\n')[0]!;
process.on('uncaughtException', (e) => console.error('[uncaught, continuing]', firstLine(e)));
process.on('unhandledRejection', (e) => console.error('[unhandled, continuing]', firstLine(e)));
const SITE_TIMEOUT_MS = 150_000;
async function runSiteSafe(site: Site): Promise<Row> {
  const error = (note: string): Row => ({
    site: slug(site.url), url: site.url, cmp: site.cmp, lang: site.lang, result: 'ERROR', ms: null, oho: '-', notes: [note], checks: [], clicks: [],
  });
  const timeout = new Promise<Row>((res) => setTimeout(() => res(error(`site timed out after ${SITE_TIMEOUT_MS / 1000} s`)), SITE_TIMEOUT_MS));
  return Promise.race([runSite(site).catch((e) => error(firstLine(e))), timeout]);
}

const rows: Row[] = [];
const queue = [...todo];
await Promise.all(
  Array.from({ length: Math.max(1, args.concurrency) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const r = await runSiteSafe(s);
      rows.push(r);
      console.log(`${r.result.padEnd(9)} ${r.site.padEnd(28)} ${r.cmp.padEnd(22)} ${String(r.ms ?? '-').padStart(6)} ms  ${r.oho}  ${r.notes[0] ?? ''}`);
    }
  }),
);

// A MISS under parallel load is retried once, alone, before it is reported (step 2 of the live
// investigation: the 4 MISSes of an earlier run all passed when rerun one at a time).
const misses = rows.filter((r) => r.result === 'MISS');
for (const m of misses) {
  const site = todo.find((s) => s.url === m.url)!;
  const again = await runSiteSafe(site);
  again.notes.unshift(again.result === 'MISS' ? 'MISS confirmed on a solo retry' : `MISS under concurrency ${args.concurrency}; solo retry: ${again.result}`);
  rows[rows.indexOf(m)] = again;
  console.log(`retry     ${again.site.padEnd(28)} -> ${again.result}`);
}

// ---- report ----
const order = sites.map((s) => s.url);
rows.sort((x, y) => order.indexOf(x.url) - order.indexOf(y.url));
const tally = rows.reduce<Record<string, number>>((t, r) => ((t[r.result] = (t[r.result] ?? 0) + 1), t), {});
const md = [
  `# oho live report (${args.label === 'eu' ? 'EU, via proxy' : args.label === 'non-eu' ? 'from a non-EU location' : args.label})`,
  '',
  `Generated ${new Date().toISOString()} - ${rows.length} sites - ${args.proxy ? `proxy ${args.proxy}` : 'no proxy'} - ${args.headed ? 'headed' : 'headless'}`,
  '',
  Object.entries(tally).map(([k, v]) => `**${k}**: ${v}`).join(' · '),
  '',
  '| site | CMP | result | time (ms) | notes |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| [${r.site}](${r.url}) | ${r.cmp} | ${r.result} | ${r.ms ?? '-'} | ${r.notes.join('<br>').replace(/\|/g, '\\|')} |`),
  '',
];
if (tally['NOT SHOWN']) {
  md.push(
    `> **${tally['NOT SHOWN']} site(s) showed no banner.** Many CMPs only show banners to EU/EEA visitors.`,
    `> Re-run through an EU exit: \`node tests/live/run.ts --proxy http://<eu-proxy>:<port>\`.`,
    '',
  );
}
writeFileSync(path.join(LIVE, `report-${args.label}.md`), md.join('\n'));
writeFileSync(path.join(LIVE, `report-${args.label}.json`), JSON.stringify({ generated: new Date().toISOString(), proxy: args.proxy ?? null, tally, rows }, null, 2));
console.log('\n', tally);
if (tally['NOT SHOWN']) console.log(`note: ${tally['NOT SHOWN']} site(s) showed no banner. Many CMPs target EU/EEA visitors only: re-run with --proxy <EU proxy>.`);
console.log(`report: tests/live/report-${args.label}.md`);
