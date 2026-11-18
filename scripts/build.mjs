// Build: esbuild bundles -> dist/{chrome,firefox} -> oho-chrome.zip / oho-firefox.zip
//   node scripts/build.mjs             release build + zips
//   node scripts/build.mjs --bench     instrumented bundle for tests/bench.mjs (dist/bench)
//   node scripts/build.mjs --collector dev-only feature collector bookmarklet (training/collector.js)
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderIcon } from './icon.mjs';
import { zip } from './zip.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const args = new Set(process.argv.slice(2));

const common = {
  bundle: true,
  minify: true,
  treeShaking: true,
  target: ['chrome111', 'firefox128'],
  legalComments: 'none',
  logLevel: 'warning',
  charset: 'utf8',
};

async function bundle(outdir, bench = false) {
  const define = { __BENCH__: String(bench) };
  // Bench builds also time the script's own top-level evaluation (regex compilation, rule setup).
  const wrap = bench
    ? {
        banner: { js: 'var __ohoT0=performance.now();' },
        footer: { js: '(globalThis.__ohoBench??={ms:0,calls:0}).ms+=performance.now()-__ohoT0;' },
      }
    : {};
  await Promise.all([
    build({ ...common, ...wrap, define, entryPoints: { content: 'src/content.ts', api: 'src/api.ts', background: 'src/background.ts', popup: 'src/popup/popup.ts' }, format: 'iife', outdir }),
  ]);
}

const WEB = ['http://*/*', 'https://*/*'];

function manifest(browser) {
  const cmps = JSON.parse(readFileSync(join(root, 'rules/cmps.json'), 'utf8')).cmps;
  const frameGlobs = [...new Set(cmps.flatMap((r) => (r.frameUrl ? [`*${r.frameUrl}*`] : [])))];
  const frameMatches = cmps
    .flatMap((r) => r.frame ?? [])
    .flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]);
  const m = {
    manifest_version: 3,
    name: 'oho: Cookie Rejecter',
    short_name: 'oho',
    version: pkg.version,
    description: pkg.description,
    permissions: ['storage', 'activeTab'],
    // Same scope as the content scripts. Declared explicitly so the popup can check it and,
    // on Firefox (where MV3 host access can be withheld), request it with permissions.request().
    host_permissions: WEB,
    action: { default_popup: 'popup.html', default_title: 'oho', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    content_scripts: [
      { matches: ['http://*/*', 'https://*/*'], exclude_matches: frameMatches, js: ['content.js'], run_at: 'document_idle' },
      { matches: ['http://*/*', 'https://*/*'], js: ['api.js'], run_at: 'document_idle', world: 'MAIN' },
      { matches: frameMatches, js: ['content.js'], run_at: 'document_idle', all_frames: true },
      // First-party CNAME CMP frames (e.g. Sourcepoint on cmp2.bild.de): the browser filters by URL,
      // so oho is never injected into ordinary iframes.
      ...frameGlobs.map((g) => ({ matches: WEB, exclude_matches: frameMatches, include_globs: [g], js: ['content.js'], run_at: 'document_idle', all_frames: true })),
    ],
  };
  if (browser === 'chrome') {
    m.background = { service_worker: 'background.js' };
    m.minimum_chrome_version = '111';
  } else {
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: { id: 'oho@0khacha', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } },
      gecko_android: { strict_min_version: '142.0' },
    };
  }
  return m;
}

function dirSize(dir) {
  let n = 0;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    n += f.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return n;
}

process.chdir(root);

if (args.has('--bench')) {
  rmSync('dist/bench', { recursive: true, force: true });
  await bundle('dist/bench', true);
  console.log('bench bundle -> dist/bench');
} else if (args.has('--collector')) {
  await build({ ...common, minify: false, entryPoints: ['src/collector.ts'], format: 'iife', outfile: 'training/collector.js', define: { __BENCH__: 'false' } });
  console.log('collector -> training/collector.js');
} else {
  for (const d of ['dist/js', 'dist/chrome', 'dist/firefox']) rmSync(d, { recursive: true, force: true });
  await bundle('dist/js');
  const icons = Object.fromEntries([16, 32, 48, 128].map((s) => [s, renderIcon(s)]));
  const report = [];
  for (const browser of ['chrome', 'firefox']) {
    const out = `dist/${browser}`;
    mkdirSync(`${out}/icons`, { recursive: true });
    cpSync('dist/js', out, { recursive: true });
    cpSync('src/popup/popup.html', `${out}/popup.html`);
    cpSync('src/popup/popup.css', `${out}/popup.css`);
    for (const [s, png] of Object.entries(icons)) writeFileSync(`${out}/icons/${s}.png`, png);
    writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest(browser), null, 2));
    const zipPath = `oho-${browser}.zip`;
    const bytes = zip(out, zipPath);
    report.push({ browser, unpacked: dirSize(out), zip: bytes });
    if (bytes > 200 * 1024) throw new Error(`${zipPath} is ${bytes} bytes (> 200 KB budget)`);
  }
  rmSync('dist/js', { recursive: true, force: true });
  const js = ['content.js', 'api.js', 'background.js', 'popup.js']
    .map((f) => `${f} ${(statSync(`dist/chrome/${f}`).size / 1024).toFixed(1)} KB`)
    .join(', ');
  console.log(js);
  for (const r of report) console.log(`oho-${r.browser}.zip: ${(r.zip / 1024).toFixed(1)} KB (unpacked ${(r.unpacked / 1024).toFixed(1)} KB)`);
}
