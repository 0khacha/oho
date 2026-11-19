// Discover which real sites use which CMP. Loads every candidate, detects the CMP from
// scripts / network resources / globals / DOM, and writes only *confirmed* matches to sites.json.
//
//   node tests/live/discover.ts [--proxy http://host:port] [--concurrency 6] [--headed]
import { chromium, type Browser } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { LIVE, OHO_CMPS, UA, bannerProbe, cliArgs, detectCmps, type Site } from './lib.ts';
import { existsSync, readFileSync } from 'node:fs';

// Candidates: major EU news, retail and government sites, plus Arabic- and French-language sites.
// The CMP each one uses is NOT assumed: it is detected below.
const CANDIDATES: [url: string, lang: string][] = [
  // France
  ['https://www.lemonde.fr/', 'fr'], ['https://www.lefigaro.fr/', 'fr'], ['https://www.leparisien.fr/', 'fr'],
  ['https://www.20minutes.fr/', 'fr'], ['https://www.ouest-france.fr/', 'fr'], ['https://www.liberation.fr/', 'fr'],
  ['https://www.lequipe.fr/', 'fr'], ['https://www.marmiton.org/', 'fr'], ['https://www.leboncoin.fr/', 'fr'],
  ['https://www.fnac.com/', 'fr'], ['https://www.boulanger.com/', 'fr'], ['https://www.decathlon.fr/', 'fr'],
  ['https://www.cdiscount.com/', 'fr'], ['https://www.darty.com/', 'fr'], ['https://www.sncf-connect.com/', 'fr'],
  ['https://www.allocine.fr/', 'fr'], ['https://www.jeuxvideo.com/', 'fr'], ['https://www.franceinfo.fr/', 'fr'],
  ['https://www.lexpress.fr/', 'fr'], ['https://www.nouvelobs.com/', 'fr'], ['https://www.latribune.fr/', 'fr'],
  ['https://www.welcometothejungle.com/fr', 'fr'], ['https://www.malt.fr/', 'fr'], ['https://www.qonto.com/fr', 'fr'],
  ['https://www.payfit.com/fr/', 'fr'], ['https://www.ornikar.com/', 'fr'], ['https://www.axeptio.eu/fr/home', 'fr'],
  ['https://www.lafourche.fr/', 'fr'], ['https://www.pennylane.com/fr/', 'fr'], ['https://www.shine.fr/', 'fr'],
  ['https://www.sezane.com/fr', 'fr'], ['https://www.alan.com/fr-fr', 'fr'], ['https://www.ankorstore.com/', 'fr'],
  ['https://www.service-public.fr/', 'fr'], ['https://www.laposte.fr/', 'fr'], ['https://www.orange.fr/portail', 'fr'],
  ['https://www.leroymerlin.fr/', 'fr'], ['https://www.carrefour.fr/', 'fr'], ['https://www.blablacar.fr/', 'fr'],
  ['https://www.doctolib.fr/', 'fr'], ['https://www.programme-tv.net/', 'fr'], ['https://www.journaldesfemmes.fr/', 'fr'],
  ['https://www.lesechos.fr/', 'fr'], ['https://www.huffingtonpost.fr/', 'fr'], ['https://www.rtbf.be/', 'fr'],
  // Germany
  ['https://www.spiegel.de/', 'de'], ['https://www.bild.de/', 'de'], ['https://www.welt.de/', 'de'],
  ['https://www.zeit.de/index', 'de'], ['https://www.faz.net/', 'de'], ['https://www.sueddeutsche.de/', 'de'],
  ['https://www.heise.de/', 'de'], ['https://www.focus.de/', 'de'], ['https://www.chip.de/', 'de'],
  ['https://www.t-online.de/', 'de'], ['https://www.stern.de/', 'de'], ['https://www.kicker.de/', 'de'],
  ['https://www.n-tv.de/', 'de'], ['https://www.dm.de/', 'de'], ['https://www.rossmann.de/de/', 'de'],
  ['https://www.otto.de/', 'de'], ['https://www.mediamarkt.de/', 'de'], ['https://www.thalia.de/', 'de'],
  ['https://www.hornbach.de/', 'de'], ['https://www.obi.de/', 'de'], ['https://www.bauhaus.info/', 'de'],
  ['https://www.conrad.de/', 'de'], ['https://www.immowelt.de/', 'de'], ['https://www.immobilienscout24.de/', 'de'],
  ['https://www.check24.de/', 'de'], ['https://www.dhl.de/de/privatkunden.html', 'de'], ['https://www.bahn.de/', 'de'],
  ['https://www.lidl.de/', 'de'], ['https://www.kaufland.de/', 'de'], ['https://www.zalando.de/', 'de'],
  ['https://www.usercentrics.com/', 'en'], ['https://www.galeria.de/', 'de'], ['https://www.mytoys.de/', 'de'],
  ['https://www.computerbild.de/', 'de'], ['https://www.giga.de/', 'de'], ['https://www.netzwelt.de/', 'de'],
  ['https://www.golem.de/', 'de'], ['https://www.derstandard.at/', 'de'], ['https://www.krone.at/', 'de'],
  ['https://www.nzz.ch/', 'de'], ['https://www.20min.ch/', 'de'], ['https://www.bund.de/', 'de'],
  // Spain
  ['https://elpais.com/', 'es'], ['https://www.elmundo.es/', 'es'], ['https://www.marca.com/', 'es'],
  ['https://www.abc.es/', 'es'], ['https://www.lavanguardia.com/', 'es'], ['https://as.com/', 'es'],
  ['https://www.20minutos.es/', 'es'], ['https://www.elconfidencial.com/', 'es'], ['https://www.rtve.es/', 'es'],
  ['https://www.elperiodico.com/es/', 'es'], ['https://www.eldiario.es/', 'es'], ['https://www.mundodeportivo.com/', 'es'],
  ['https://www.elcorteingles.es/', 'es'], ['https://www.idealista.com/', 'es'], ['https://www.fotocasa.es/es/', 'es'],
  ['https://www.milanuncios.com/', 'es'], ['https://www.pccomponentes.com/', 'es'], ['https://www.renfe.com/es/es', 'es'],
  ['https://www.xataka.com/', 'es'], ['https://www.expansion.com/', 'es'], ['https://www.huffingtonpost.es/', 'es'],
  // Italy (Iubenda is mostly Italian)
  ['https://www.iubenda.com/it/', 'it'], ['https://www.aranzulla.it/', 'it'], ['https://www.ilpost.it/', 'it'],
  ['https://www.fanpage.it/', 'it'], ['https://www.giallozafferano.it/', 'it'], ['https://www.wired.it/', 'it'],
  ['https://www.hdblog.it/', 'it'], ['https://www.tomshw.it/', 'it'], ['https://www.ilfattoquotidiano.it/', 'it'],
  ['https://www.ansa.it/', 'it'], ['https://www.corriere.it/', 'it'], ['https://www.repubblica.it/', 'it'],
  ['https://www.money.it/', 'it'], ['https://www.everyeye.it/', 'it'], ['https://www.multiplayer.it/', 'it'],
  ['https://www.html.it/', 'it'], ['https://www.punto-informatico.it/', 'it'], ['https://www.dday.it/', 'it'],
  // UK / international English
  ['https://www.theguardian.com/international', 'en'], ['https://www.telegraph.co.uk/', 'en'], ['https://www.thesun.co.uk/', 'en'],
  ['https://www.independent.co.uk/', 'en'], ['https://www.express.co.uk/', 'en'], ['https://www.mirror.co.uk/', 'en'],
  ['https://www.dailymail.co.uk/home/index.html', 'en'], ['https://metro.co.uk/', 'en'], ['https://www.standard.co.uk/', 'en'],
  ['https://www.reuters.com/', 'en'], ['https://www.forbes.com/', 'en'], ['https://www.booking.com/', 'en'],
  ['https://www.ikea.com/gb/en/', 'en'], ['https://www2.hm.com/en_gb/index.html', 'en'], ['https://www.adidas.co.uk/', 'en'],
  ['https://www.oracle.com/', 'en'], ['https://www.ibm.com/', 'en'], ['https://www.redhat.com/en', 'en'],
  ['https://www.cisco.com/', 'en'], ['https://www.intel.com/content/www/us/en/homepage.html', 'en'], ['https://www.trustarc.com/', 'en'],
  ['https://www.cookiebot.com/', 'en'], ['https://www.maersk.com/', 'en'], ['https://www.ecco.com/', 'en'],
  ['https://www.bang-olufsen.com/en', 'en'], ['https://www.vestas.com/en', 'en'], ['https://www.lego.com/en-gb', 'en'],
  ['https://www.carlsberg.com/', 'en'], ['https://www.pandora.net/en-gb/', 'en'], ['https://www.novonordisk.com/', 'en'],
  ['https://www.complianz.io/', 'en'], ['https://really-simple-ssl.com/', 'en'], ['https://www.wpbeginner.com/', 'en'],
  ['https://www.techradar.com/', 'en'], ['https://www.livescience.com/', 'en'], ['https://www.cinemablend.com/', 'en'],
  ['https://www.eurogamer.net/', 'en'], ['https://www.rockpapershotgun.com/', 'en'], ['https://www.nme.com/', 'en'],
  ['https://www.gov.uk/', 'en'], ['https://www.bbc.com/', 'en'], ['https://www.economist.com/', 'en'],
  ['https://www.ft.com/', 'en'], ['https://www.irishtimes.com/', 'en'], ['https://www.dw.com/en/', 'en'],
  ['https://www.euronews.com/', 'en'], ['https://www.politico.eu/', 'en'], ['https://www.dr.dk/', 'en'],
  ['https://www.zara.com/', 'en'], ['https://www.ryanair.com/gb/en', 'en'], ['https://www.easyjet.com/en', 'en'],
  // Arabic- and French-language
  ['https://www.aljazeera.net/', 'ar'], ['https://www.alarabiya.net/', 'ar'],
  ['https://www.skynewsarabia.com/', 'ar'], ['https://www.bbc.com/arabic', 'ar'], ['https://arabic.cnn.com/', 'ar'],
  ['https://www.france24.com/ar/', 'ar'], ['https://www.dw.com/ar/', 'ar'],
  ['https://www.euronews.com/arabic', 'ar'],
];

const args = cliArgs();
// --extra <file.json>: probe only these [url, lang] pairs and merge into the existing discover-raw.json
const extraIdx = process.argv.indexOf('--extra');
const extraFile = extraIdx > 0 ? process.argv[extraIdx + 1] : undefined;
const RAW = path.join(LIVE, 'discover-raw.json');
const rules = JSON.parse(readFileSync(path.join(LIVE, '..', '..', 'rules', 'cmps.json'), 'utf8')).cmps;

interface Raw { url: string; lang: string; ok: boolean; error?: string; title?: string; finalUrl?: string; evidence?: Record<string, string[]>; apis?: Record<string, string>; banner?: { visible: boolean; by: string } }

async function probe(browser: Browser, url: string, lang: string): Promise<Raw> {
  const ctx = await browser.newContext({ userAgent: UA, locale: lang === 'ar' ? 'ar' : `${lang}-${lang.toUpperCase()}`, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // CMP scripts load late; poll for a visible banner for up to 10 s
    let banner = { visible: false, by: '' };
    for (let i = 0; i < 20 && !banner.visible; i++) {
      await page.waitForTimeout(500);
      banner = await page.evaluate(bannerProbe, rules).catch(() => banner);
    }
    const d = await page.evaluate(detectCmps);
    return { url, lang, ok: true, title: d.title, finalUrl: d.url, evidence: d.evidence, apis: d.apis, banner };
  } catch (e) {
    return { url, lang, ok: false, error: String(e).split('\n')[0] };
  } finally {
    await ctx.close();
  }
}

const browser = await chromium.launch({
  channel: 'chromium',
  headless: !args.headed,
  proxy: args.proxy ? { server: args.proxy } : undefined,
});
const extra: [string, string][] | null = extraFile ? JSON.parse(readFileSync(extraFile, 'utf8')) : null;
const previous: Raw[] = extra && existsSync(RAW) ? JSON.parse(readFileSync(RAW, 'utf8')) : [];
const raw: Raw[] = [];
const queue = [...(extra ?? CANDIDATES)];
await Promise.all(
  Array.from({ length: Math.max(1, args.concurrency || 6) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const r = await probe(browser, c[0], c[1]);
      raw.push(r);
      const cmps = Object.keys(r.evidence ?? {});
      console.log(`${r.ok ? 'ok ' : 'ERR'} ${c[0].padEnd(52)} ${cmps.join(',') || '-'} ${r.banner?.visible ? 'BANNER(' + r.banner.by + ')' : ''} ${r.error ?? ''}`);
    }
  }),
);
await browser.close();
raw.push(...previous.filter((p) => !raw.some((r) => r.url === p.url)));
writeFileSync(RAW, JSON.stringify(raw, null, 2));

// Confirmed = evidence for exactly one oho CMP. Picks: banner actually seen first, then
// round-robin over languages so each CMP is tested in as many languages as possible.
const PER_CMP = 5;
const sites: Site[] = [];
function pick(rs: Raw[]): Raw[] {
  const out: Raw[] = [];
  for (const tier of [rs.filter((r) => r.banner?.visible), rs.filter((r) => !r.banner?.visible)]) {
    const byLang = new Map<string, Raw[]>();
    for (const r of tier) byLang.set(r.lang, [...(byLang.get(r.lang) ?? []), r]);
    while (out.length < PER_CMP && [...byLang.values()].some((l) => l.length)) {
      for (const l of byLang.values()) if (l.length && out.length < PER_CMP) out.push(l.shift()!);
    }
  }
  return out;
}
for (const cmp of OHO_CMPS) {
  const hits = raw.filter((r) => r.ok && r.evidence?.[cmp] && OHO_CMPS.filter((c) => r.evidence?.[c]).length === 1);
  for (const r of pick(hits)) sites.push({ url: r.url, cmp, lang: r.lang, evidence: r.evidence![cmp] });
}
// Custom/unknown: a banner was actually seen and no oho CMP was detected.
for (const r of pick(raw.filter((r) => r.ok && r.banner?.visible && !OHO_CMPS.some((c) => r.evidence?.[c])))) {
  const other = Object.keys(r.evidence ?? {}).find((k) => k.startsWith('other:'));
  sites.push({ url: r.url, cmp: 'custom', lang: r.lang, other: other?.slice(6) ?? 'unknown', evidence: [r.banner!.by] });
}
writeFileSync(
  path.join(LIVE, 'sites.json'),
  JSON.stringify({ generated: new Date().toISOString(), note: 'Generated by tests/live/discover.ts; CMPs are detected, not assumed.', sites }, null, 2) + '\n',
);
const counts = Object.fromEntries([...OHO_CMPS, 'custom'].map((c) => [c, sites.filter((s) => s.cmp === c).length]));
console.log('\nsites.json:', counts);
console.log('banners visible during discovery:', raw.filter((r) => r.banner?.visible).length, '/', raw.length);
