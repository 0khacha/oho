// Long-run resource test (not part of `npm run check`): 10 fixture tabs open for 60 s with the real
// extension loaded. Measures, with Chrome DevTools Protocol:
//   - CPU time of oho's content scripts per tab (V8 sampling profiler; only samples whose code comes
//     from chrome-extension://<id>/content.js or api.js count, so the fixtures' own scripts don't),
//     split into the first 11 s (oho's 10 s watch window) and the rest;
//   - CPU time of the service worker over the same 60 s, and whether Chrome stops it once idle;
//   - JS heap per tab at 12 s and 60 s, with and without oho.
// Writes tests/resources-report.md and fails if oho uses CPU after its observer has disconnected.
//
//   npm run resources
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start } from './server.mjs';

const FIXTURES = ['onetrust', 'onetrust-prefs', 'cookiebot', 'didomi', 'usercentrics-v3', 'trustarc-notice', 'custom-fr', 'iubenda-paywall', 'heavy', 'busy'];
const RUN_MS = 60_000;
const ACTIVE_MS = 11_000; // oho watches for 10 s after it starts; 1 s margin
const IDLE_LIMIT_MS = 1; // "about zero": total oho CPU allowed per tab after the active window
const SW_IDLE_WAIT_MS = 60_000; // how long to wait for Chrome to stop the idle service worker
const SAMPLING_US = 100;
const EXT = path.resolve('dist/chrome');

/** Minimal raw CDP client for the browser endpoint (service-worker targets aren't exposed by Playwright). */
function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else listeners.forEach((f) => f(msg));
  };
  const ready = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return {
    ready,
    send: (method, params = {}, sessionId) => new Promise((res, rej) => {
      const m = { id: ++id, method, params };
      if (sessionId) m.sessionId = sessionId;
      pending.set(m.id, { res, rej });
      ws.send(JSON.stringify(m));
    }),
    on: (f) => listeners.push(f),
    close: () => ws.close(),
  };
}

/** Sum a CPU profile's sample time (ms) for nodes matching `match`, split at `splitMs` after `t0` (µs). */
function attribute(profile, match, t0, splitMs) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  let t = profile.startTime;
  const out = { before: 0, after: 0, lastAt: null };
  for (let i = 0; i < profile.samples.length; i++) {
    t += profile.timeDeltas[i];
    const dur = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    const node = byId.get(profile.samples[i]);
    if (!node || !match(node.callFrame.url)) continue;
    const at = (t - t0) / 1000;
    if (at < splitMs) out.before += dur;
    else out.after += dur;
    out.lastAt = at;
  }
  return out;
}

async function metrics(cdp) {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  const get = (k) => m.find((x) => x.name === k)?.value ?? 0;
  return { heap: get('JSHeapUsedSize'), script: get('ScriptDuration') * 1000 };
}

async function run(withOho, base) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oho-res-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: true,
    args: [
      '--remote-debugging-port=0',
      ...(withOho ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : []),
    ],
  });
  const res = { tabs: [], sw: null };
  let browserCdp = null;
  let swSession = null;
  let swTargetId = null;
  let extId = '';
  if (withOho) {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    extId = new URL(sw.url()).host;
    const [port, wsPath] = readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').trim().split('\n');
    browserCdp = cdpClient(`ws://127.0.0.1:${port}${wsPath}`);
    await browserCdp.ready;
    const { targetInfos } = await browserCdp.send('Target.getTargets');
    const t = targetInfos.find((x) => x.type === 'service_worker' && x.url.includes(extId));
    swTargetId = t.targetId;
    ({ sessionId: swSession } = await browserCdp.send('Target.attachToTarget', { targetId: swTargetId, flatten: true }));
    await browserCdp.send('Profiler.enable', {}, swSession);
    await browserCdp.send('Profiler.setSamplingInterval', { interval: SAMPLING_US }, swSession);
    await browserCdp.send('Profiler.start', {}, swSession);
  }
  const isOho = (url) => !!extId && url.startsWith(`chrome-extension://${extId}/`);

  // Open the tabs. A same-origin blank page first, so the profiler starts in the renderer that will
  // run the fixture (a cross-origin navigation would swap processes and lose it).
  for (const fx of FIXTURES) {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(base + '_blank', { waitUntil: 'commit' }).catch(() => {});
    await cdp.send('Performance.enable');
    // The profiler runs in both passes, so its own heap use is in the baseline too.
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: SAMPLING_US });
    await cdp.send('Profiler.start');
    const t0 = Date.now();
    await page.goto(base + fx + '.html', { waitUntil: 'load' });
    res.tabs.push({ fx, page, cdp, t0 });
  }
  const t0All = res.tabs[0].t0;
  const lastStart = res.tabs.at(-1).t0;

  // Heap at 12 s after each tab opened, then at 60 s.
  for (const tab of res.tabs) {
    const wait = tab.t0 + 12_000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    tab.at12 = await metrics(tab.cdp);
  }
  const endAt = lastStart + RUN_MS;
  await new Promise((r) => setTimeout(r, Math.max(0, endAt - Date.now())));
  for (const tab of res.tabs) {
    tab.at60 = await metrics(tab.cdp);
    const { profile } = await tab.cdp.send('Profiler.stop');
    // The profile's clock: the first sample is at startTime; the navigation started right after.
    if (withOho) tab.cpu = attribute(profile, isOho, profile.startTime, ACTIVE_MS);
    tab.result = await tab.page.evaluate(() => window.__oho?.result ?? null).catch(() => null);
  }

  if (withOho) {
    const { profile } = await browserCdp.send('Profiler.stop', {}, swSession);
    const split = (lastStart - t0All + ACTIVE_MS) * 1000; // after every tab's active window
    const swCpu = attribute(profile, isOho, profile.startTime, split / 1000);
    const heap = await browserCdp.send('Runtime.getHeapUsage', {}, swSession).catch(() => null);
    res.sw = { cpu: swCpu, heap: heap?.usedSize ?? null, splitS: split / 1e6 };
    browserCdp.close();
  }
  await ctx.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  return res;
}

/**
 * Idle shutdown, with nothing attached to the service worker: an attached debugger (the profiler
 * above, or Playwright's own auto-attach) keeps a worker alive. Plain Chromium is started without
 * Playwright, the same tabs are opened through the browser endpoint without attaching to anything,
 * and Target.getTargets is polled until the service worker is gone.
 */
async function idleShutdown(base) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'oho-idle-'));
  const proc = spawn(chromium.executablePath(), [
    '--headless=new', `--user-data-dir=${dir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
  const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
  const cdp = cdpClient(`ws://127.0.0.1:${port}${wsPath}`);
  await cdp.ready;
  const swRunning = async () => (await cdp.send('Target.getTargets')).targetInfos.some((x) => x.type === 'service_worker' && x.url.startsWith('chrome-extension://'));
  let seen = false;
  for (let i = 0; i < 100 && !(seen = await swRunning()); i++) await new Promise((r) => setTimeout(r, 100));
  for (const fx of FIXTURES) await cdp.send('Target.createTarget', { url: base + fx + '.html' });
  const opened = Date.now();
  let stoppedAfter = null;
  while (Date.now() - opened < SW_IDLE_WAIT_MS + RUN_MS) {
    await new Promise((r) => setTimeout(r, 1000));
    if (!(await swRunning())) { stoppedAfter = Date.now() - opened; break; }
  }
  cdp.close();
  proc.kill();
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  return { seen, stoppedAfter, waitedS: (SW_IDLE_WAIT_MS + RUN_MS) / 1000 };
}

const server = await start(0);
const base = `http://127.0.0.1:${server.address().port}/`;
console.log('run 1/2: with oho (about 2 min)');
const oho = await run(true, base);
console.log('run 2/2: without oho, for the heap baseline (about 1 min)');
const bare = await run(false, base);
console.log('idle check: plain Chromium, nothing attached to the service worker (up to 2 min)');
const idle = await idleShutdown(base);
server.close();

// ---- report ----
const kb = (b) => (b / 1024).toFixed(0);
const ms = (x) => x.toFixed(2);
const rows = oho.tabs.map((t, i) => {
  const b = bare.tabs[i];
  return { fx: t.fx, result: t.result ?? '-', before: t.cpu.before, after: t.cpu.after, lastAt: t.cpu.lastAt,
    heap12: t.at12.heap, heap60: t.at60.heap, bare60: b.at60.heap, pageScript: t.at60.script, bareScript: b.at60.script };
});
const worstAfter = Math.max(...rows.map((r) => r.after));
const swAfter = oho.sw.cpu.after;
const pass = worstAfter <= IDLE_LIMIT_MS && swAfter <= IDLE_LIMIT_MS && idle.stoppedAfter != null;
const md = [
  '# oho resource test',
  '',
  `Generated by \`npm run resources\` (\`tests/resources.mjs\`) on ${new Date().toISOString().slice(0, 10)}. Chromium headless, release build`,
  `(\`dist/chrome\`), ${FIXTURES.length} fixture tabs open at once for ${RUN_MS / 1000} s. CPU: V8 sampling profiler at ${SAMPLING_US} µs,`,
  `counting only samples in oho's own scripts (\`content.js\`, \`api.js\`, \`background.js\`). Heap: \`Performance.getMetrics\``,
  '`JSHeapUsedSize` of the tab (the page and oho share one heap), compared with the same tabs without oho.',
  '',
  `**Result: ${pass ? 'PASS' : 'FAIL'}.** After its ${ACTIVE_MS / 1000} s active window, oho used at most **${ms(worstAfter)} ms** of CPU in any tab`,
  `(limit ${IDLE_LIMIT_MS} ms), and the service worker **${ms(swAfter)} ms**. ${idle.stoppedAfter != null ? `With nothing attached, Chrome stopped the idle service worker **${(idle.stoppedAfter / 1000).toFixed(0)} s** after the tabs opened.` : `The service worker was still running ${idle.waitedS} s after the tabs opened.`}`,
  '',
  '## Content scripts, per tab',
  '',
  '| fixture | outcome | oho CPU 0–11 s (ms) | oho CPU 11–60 s (ms) | last oho sample | heap 12 s (KB) | heap 60 s (KB) | heap without oho, 60 s (KB) |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.fx} | ${r.result} | ${ms(r.before)} | ${ms(r.after)} | ${r.lastAt == null ? '-' : (r.lastAt / 1000).toFixed(1) + ' s'} | ${kb(r.heap12)} | ${kb(r.heap60)} | ${kb(r.bare60)} |`),
  '',
  `Total oho CPU over all ${FIXTURES.length} tabs: ${ms(rows.reduce((s, r) => s + r.before + r.after, 0))} ms in 60 s. For scale, all script time in those tabs`,
  `(\`Performance.getMetrics\` \`ScriptDuration\`, page and oho together) was ${ms(rows.reduce((s, r) => s + r.pageScript, 0))} ms, and ${ms(rows.reduce((s, r) => s + r.bareScript, 0))} ms without oho.`,
  "The sampling profiler can miss calls shorter than its interval (oho's observer callbacks on `busy` are), so",
  "\"last oho sample\" is the last one it caught, not necessarily oho's last call. After the observer disconnects there is",
  'nothing left for oho to run, which is what the 11–60 s column checks.',
  '',
  '## Service worker',
  '',
  `- CPU while the tabs loaded and reported (first ${oho.sw.splitS.toFixed(1)} s): ${ms(oho.sw.cpu.before)} ms.`,
  `- CPU afterwards, until 60 s: ${ms(swAfter)} ms${oho.sw.cpu.lastAt != null ? ` (last sample at ${(oho.sw.cpu.lastAt / 1000).toFixed(1)} s)` : ''}.`,
  `- JS heap at 60 s: ${oho.sw.heap == null ? 'n/a' : kb(oho.sw.heap) + ' KB'}.`,
  `- Idle shutdown: ${idle.stoppedAfter != null ? `Chrome stopped it ${(idle.stoppedAfter / 1000).toFixed(0)} s after the tabs opened` : `still running ${idle.waitedS} s after the tabs opened`}.` +
    ' Checked in a separate pass with plain Chromium and nothing attached to the worker, because an attached debugger',
  "  (the profiler, or Playwright's own auto-attach) keeps a service worker alive.",
  '',
  'GC and compilation time are not attributed to a script by the profiler, so they are not counted.',
  '',
];
writeFileSync('tests/resources-report.md', md.join('\n'));
console.log(md.join('\n'));
if (!pass) process.exit(1);
