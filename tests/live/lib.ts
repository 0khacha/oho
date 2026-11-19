// Shared helpers for the live (real-website) tests. Runs on Node >= 23 (native TS type stripping).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
export const LIVE = path.join(ROOT, 'tests', 'live');

export const OHO_CMPS = [
  'onetrust', 'cookiebot', 'didomi', 'quantcast', 'trustarc',
  'usercentrics', 'sourcepoint', 'axeptio', 'iubenda', 'complianz',
] as const;
export type CmpId = (typeof OHO_CMPS)[number] | 'custom';

export interface Site {
  url: string;
  cmp: CmpId;
  lang: string;
  /** For custom: which non-oho CMP (if any) was recognised. */
  other?: string;
  evidence?: string[];
}

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36';

export function cliArgs(argv = process.argv.slice(2)) {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    headed: argv.includes('--headed'),
    proxy: get('--proxy'),
    only: get('--only'),
    /** report-<label>.md / .json: 'non-eu' (from a non-EU location, no proxy) by default, 'eu' with --proxy. */
    label: get('--label') ?? (get('--proxy') ? 'eu' : 'non-eu'),
    concurrency: Number(get('--concurrency') ?? 3),
  };
}

/* ---------------- keyword safety check (same lists + boundaries as src/shared/keywords.ts) ---------------- */
const kw = JSON.parse(readFileSync(path.join(ROOT, 'rules', 'keywords.json'), 'utf8')) as Record<string, string[]>;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '[0-9a-z\\u00c0-\\u024f\\u0600-\\u06ff]';
const compile = (words: string[]): RegExp =>
  new RegExp(`(?<!${WORD})(?:${[...words].sort((a, b) => b.length - a.length).map(esc).join('|')})(?!${WORD})`);
const RE = { reject: compile(kw.reject!), accept: compile(kw.accept!), save: compile(kw.save!) };
const norm = (s: string): string => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();

/** True when a clicked label reads as "accept" (and not as reject or as a save-selection button). */
export function isAcceptClick(label: string): boolean {
  const t = norm(label);
  if (!t || RE.reject.test(t)) return false;
  return RE.accept.test(t) && !RE.save.test(t);
}

/* ---------------- page-side probes (serialised into the page with page.evaluate) ---------------- */

/** Which CMPs are present (scripts, network resources, globals, DOM), plus which reject APIs exist. */
export const detectCmps = () => {
  const w = window as unknown as Record<string, any>;
  const urls = [
    ...[...document.scripts].map((s) => s.src),
    ...performance.getEntriesByType('resource').map((e) => e.name),
    ...[...document.querySelectorAll('iframe')].map((f) => f.src),
  ].join(' ');
  const id = (x: string): boolean => !!document.getElementById(x);
  const q = (x: string): boolean => !!document.querySelector(x);
  const ev: Record<string, string[]> = {};
  const add = (cmp: string, why: string, hit: boolean): void => {
    if (hit) (ev[cmp] ??= []).push(why);
  };
  add('onetrust', 'script', /cdn\.cookielaw\.org|otSDKStub|optanon\.blob|onetrust\.com\/consent/i.test(urls));
  add('onetrust', 'global', !!w.OneTrust || !!w.Optanon);
  add('onetrust', 'dom', id('onetrust-consent-sdk'));
  add('cookiebot', 'script', /consent\.cookiebot\.(com|eu)/i.test(urls));
  add('cookiebot', 'global', !!w.Cookiebot);
  add('cookiebot', 'dom', id('CybotCookiebotDialog'));
  add('didomi', 'script', /sdk\.privacy-center\.org|didomi/i.test(urls));
  add('didomi', 'global', !!w.Didomi);
  add('didomi', 'dom', id('didomi-host'));
  add('quantcast', 'script', /quantcast\.mgr\.consensu|cmp\.inmobi\.com|cmp\.quantcast\.com/i.test(urls));
  add('quantcast', 'dom', id('qc-cmp2-container') || q('.qc-cmp2-container'));
  add('trustarc', 'script', /consent\.trustarc\.com|consent\.truste\.com|trustarc\.mgr\.consensu/i.test(urls));
  add('trustarc', 'global', !!w.truste);
  add('trustarc', 'dom', id('truste-consent-track') || id('consent_blackbar'));
  add('usercentrics', 'script', /usercentrics\.eu|usercentrics\.com\/.*\.js/i.test(urls));
  add('usercentrics', 'global', !!w.UC_UI || !!w.__ucCmp);
  add('usercentrics', 'dom', id('usercentrics-root') || id('usercentrics-cmp-ui'));
  add('sourcepoint', 'script', /privacy-mgmt\.com|sp-prod\.net|wrapperMessagingWithoutDetection|sourcepoint/i.test(urls));
  add('sourcepoint', 'global', !!w._sp_ || !!w._sp_queue);
  add('sourcepoint', 'dom', q("[id^='sp_message_container_']"));
  add('axeptio', 'script', /axept\.io/i.test(urls));
  add('axeptio', 'global', !!w.axeptioSettings || !!w.__axeptioSDK);
  add('axeptio', 'dom', id('axeptio_overlay'));
  add('iubenda', 'script', /cdn\.iubenda\.com|cs\.iubenda\.com/i.test(urls));
  add('iubenda', 'global', !!w._iub);
  add('iubenda', 'dom', id('iubenda-cs-banner'));
  add('complianz', 'script', /complianz/i.test(urls));
  add('complianz', 'dom', id('cmplz-cookiebanner-container') || q('.cmplz-cookiebanner'));
  // CMPs oho has no rule for: these count as "custom/unknown" banners for oho
  add('other:google-fc', 'any', id('fc-consent-root') || /fundingchoicesmessages\.google\.com/i.test(urls));
  add('other:consentmanager', 'any', id('cmpbox') || /consentmanager\.(net|de)|cdn\.consentmanager/i.test(urls));
  add('other:cookieyes', 'any', q('.cky-consent-container') || /cdn-cookieyes\.com/i.test(urls));
  add('other:borlabs', 'any', id('BorlabsCookieBox') || q('#BorlabsCookieBoxWrap'));
  add('other:tarteaucitron', 'any', id('tarteaucitronRoot'));
  add('other:sirdata', 'any', /sddan\.com|cmp\.sirdata/i.test(urls));
  add('other:commandersact', 'any', /cdn\.trustcommander\.net|tagcommander/i.test(urls) || !!w.tC);
  add('other:sfbx-appconsent', 'any', /appconsent\.io|sfbx\.io/i.test(urls));
  add('other:cookieinformation', 'any', id('coiOverlay') || /policy\.app\.cookieinformation\.com/i.test(urls));
  add('other:cookiescript', 'any', id('cookiescript_injected'));
  add('other:osano', 'any', q('.osano-cm-window'));
  add('other:klaro', 'any', q('.klaro'));
  add('other:piwikpro', 'any', q('#ppms_cm_consent_popup_wrapper'));
  add('other:gravito', 'any', /gravito\.net/i.test(urls));
  add('other:cookiefirst', 'any', /consent\.cookiefirst\.com/i.test(urls));
  add('other:termly', 'any', /app\.termly\.io/i.test(urls));
  const fn = (o: unknown, k: string): string => (o ? typeof (o as Record<string, unknown>)[k] : 'no-object');
  const apis = {
    'OneTrust.RejectAll': fn(w.OneTrust, 'RejectAll'),
    'Cookiebot.decline': fn(w.Cookiebot, 'decline'),
    'Cookiebot.submitCustomConsent': fn(w.Cookiebot, 'submitCustomConsent'),
    'Didomi.setUserDisagreeToAll': fn(w.Didomi, 'setUserDisagreeToAll'),
    'UC_UI.denyAllConsents': fn(w.UC_UI, 'denyAllConsents'),
    '__ucCmp.denyAllConsents': fn(w.__ucCmp, 'denyAllConsents'),
    __tcfapi: typeof w.__tcfapi,
  };
  return { evidence: ev, apis, title: document.title, url: location.href };
};

/**
 * Is a consent banner visible right now? CMP-specific selectors first, then a generic check:
 * a visible fixed/sticky/dialog element whose text talks about cookies/consent (5 languages).
 */
export const bannerProbe = (rules: { id: string; detect: string; visible?: string; shadow?: string; frame?: string[] }[]) => {
  const vis = (el: Element | null | undefined): boolean => {
    if (!el || !(el as HTMLElement).isConnected) return false;
    const he = el as HTMLElement;
    if (he.checkVisibility && !he.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true } as CheckVisibilityOptions)) return false;
    const r = he.getBoundingClientRect();
    return r.width > 40 && r.height > 15 && r.bottom > 0 && r.top < innerHeight;
  };
  for (const r of rules) {
    if (r.frame || !document.querySelector(r.detect)) continue;
    let root: ParentNode = document;
    if (r.shadow) {
      const host = document.querySelector(r.shadow);
      root = host?.shadowRoot ?? host ?? document;
    }
    for (const el of root.querySelectorAll(r.visible ?? r.detect)) if (vis(el)) return { visible: true, by: 'rule:' + r.id };
  }
  for (const f of document.querySelectorAll('iframe')) {
    const tag = f.src + ' ' + f.id + ' ' + f.title;
    if (/google_ads|doubleclick|googlesyndication|adnxs|amazon-adsystem/i.test(tag)) continue; // ad slots (e.g. "eb_noconsent_megaboard")
    if (/^offer_|tinypass|piano\.io/i.test(f.id + ' ' + f.src)) continue; // Piano subscription offers (tagesspiegel)
    if (/privacy-mgmt|sp_message|consent|cmp|trustarc/i.test(tag) && vis(f) && f.getBoundingClientRect().height > 80)
      return { visible: true, by: 'iframe:' + (f.id || f.src.slice(0, 60)) };
  }
  const TEXT = /cookie|consent|gdpr|rgpd|dsgvo|datenschutz|einwilligung|privacidad|confidentialit|vie privée|traceurs|ملفات تعريف الارتباط|الكوكيز|ملفات الارتباط|الخصوصية/i;
  const pick = [
    ...document.body.children,
    ...document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open],[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i]'),
  ].slice(0, 400);
  for (const el of pick) {
    if (!vis(el)) continue;
    let fixed = false;
    for (let e: Element | null = el, d = 0; e && d < 6; e = e.parentElement, d++) {
      const p = getComputedStyle(e).position;
      if (p === 'fixed' || p === 'sticky') { fixed = true; break; }
    }
    if (!fixed && !el.matches('[role=dialog],[aria-modal=true],dialog[open]')) continue;
    const sr = (el as HTMLElement).shadowRoot;
    const text = ((el as HTMLElement).innerText || '') + ' ' + (sr ? (sr as unknown as HTMLElement).textContent : '');
    const r = el.getBoundingClientRect();
    if (TEXT.test(text) && r.width * r.height > innerWidth * innerHeight * 0.01 && text.length < 6000)
      return { visible: true, by: 'generic:' + (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.getAttribute('class') ?? '').split(' ')[0]) };
  }
  return { visible: false, by: '' };
};

/** Can the page scroll, and is the viewport centre covered by a big fixed layer? */
export const layoutProbe = async () => {
  const se = document.scrollingElement ?? document.documentElement;
  const before = se.scrollTop;
  const canGrow = se.scrollHeight > innerHeight + 50;
  // behavior:'instant' defeats `scroll-behavior: smooth` (payfit.com), which would make an
  // immediate read look like "did not scroll".
  se.scrollTo({ top: before + 300, behavior: 'instant' as ScrollBehavior });
  await new Promise((r) => setTimeout(r, 300));
  const moved = se.scrollTop !== before;
  se.scrollTo({ top: before, behavior: 'instant' as ScrollBehavior });
  const lock = [document.documentElement, document.body].some((e) => e && getComputedStyle(e).overflowY === 'hidden');
  let covered = '';
  const c = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  for (let e: Element | null = c; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    // Only a near-empty backdrop or a layer that is itself about cookies counts as "covered"
    // (full-screen ad takeovers / promos with real content are the site's business).
    const txt = ((e as HTMLElement).innerText ?? '').trim();
    const blocking = txt.length < 30 || /cookie|consent|gdpr|rgpd|datenschutz|privacidad|confidentialit/i.test(txt);
    if (cs.position === 'fixed' && r.width * r.height > innerWidth * innerHeight * 0.6 && blocking) {
      covered = e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') ?? '').split(' ')[0];
      break;
    }
  }
  // A lock can come from the site's own modal (country picker, login...), not from a cookie banner.
  const COOKIE = /cookie|consent|gdpr|rgpd|datenschutz|privacidad|confidentialit|الخصوصية|الكوكيز/i;
  let siteModal = '';
  for (const e of document.querySelectorAll('[role=dialog],[aria-modal=true],dialog[open]')) {
    const r = e.getBoundingClientRect();
    if (r.width > 100 && r.height > 50 && !COOKIE.test((e as HTMLElement).innerText ?? '')) {
      siteModal = ((e as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 50);
      break;
    }
  }
  return { scrollable: !canGrow || moved, canGrow, moved, lock, covered, siteModal };
};

/** Bot protection / captcha interstitial instead of the real page (DataDome, Cloudflare, Akamai...). */
export const botWallProbe = () => {
  const t = (document.title + ' ' + (document.body?.innerText ?? '').slice(0, 1500)).toLowerCase();
  const frames = [...document.querySelectorAll('iframe')].map((f) => f.src).join(' ');
  return /captcha-delivery\.com|challenges\.cloudflare\.com|hcaptcha\.com|geo\.captcha/.test(frames) ||
    /non pas à un robot|not a robot|are you a robot|are you human|verify you are human|just a moment|access denied|zugriff verweigert|checking your browser|unusual traffic/.test(t);
};

export interface Check { name: string; ok: boolean | null; detail: string }

/** Read the CMP's own stored choice (and TCF) to prove the refusal was recorded. ok=null: not applicable. */
export const consentProbe = async (cmp: string) => {
  const w = window as unknown as Record<string, any>;
  const checks: { name: string; ok: boolean | null; detail: string }[] = [];
  const cookies: Record<string, string> = {};
  for (const c of document.cookie.split('; ')) {
    const i = c.indexOf('=');
    if (i > 0) cookies[c.slice(0, i)] = (() => { try { return decodeURIComponent(c.slice(i + 1)); } catch { return c.slice(i + 1); } })();
  }
  const on = (o: Record<string, boolean> | undefined): string[] => Object.entries(o ?? {}).filter(([, v]) => v).map(([k]) => k);

  if (typeof w.__tcfapi === 'function') {
    const tc = await new Promise<any>((res) => {
      let done = false;
      const end = (v: any): void => { if (!done) { done = true; res(v); } };
      try { w.__tcfapi('getTCData', 2, (d: any, ok: boolean) => end(ok ? d : null)); } catch { end(null); }
      setTimeout(() => end(null), 4000);
    });
    if (!tc) checks.push({ name: 'tcf', ok: null, detail: 'getTCData gave no answer' });
    else if (tc.gdprApplies === false) checks.push({ name: 'tcf', ok: null, detail: 'gdprApplies=false (geo: TCF not in force)' });
    else {
      const pc = on(tc.purpose?.consents), vc = on(tc.vendor?.consents);
      const pli = on(tc.purpose?.legitimateInterests), vli = on(tc.vendor?.legitimateInterests);
      const has = !!tc.tcString;
      checks.push({
        name: 'tcf',
        ok: has && pc.length === 0 && vc.length === 0,
        detail: `${has ? 'tcString set' : 'NO tcString'}, status=${tc.eventStatus}; purpose consents on: [${pc}]; vendor consents on: ${vc.length}` +
          ` | legitimate interest (reported only): purposes [${pli}], vendors ${vli.length}`,
      });
    }
  }

  if (cmp === 'onetrust') {
    const v = cookies.OptanonConsent;
    if (!v) checks.push({ name: 'OptanonConsent', ok: false, detail: 'cookie missing' });
    else {
      const groups = (/groups=([^&]*)/.exec(v)?.[1] ?? '').split(',').filter(Boolean);
      // Groups the site marks "always active" cannot be refused by anyone: report, don't fail.
      let always: string[] = [];
      try {
        always = (w.OneTrust?.GetDomainData?.().Groups ?? []).filter((g: any) => /always active/i.test(g.Status ?? '')).map((g: any) => g.OptanonGroupId);
      } catch { /* old SDK */ }
      const isNecessary = (id: string): boolean => always.includes(id) || /^(C0001|1)$/.test(id);
      const on = groups.filter((g) => g.endsWith(':1')).map((g) => g.slice(0, -2));
      const bad = on.filter((g) => !isNecessary(g));
      const forced = on.filter((g) => isNecessary(g) && g !== 'C0001' && g !== '1');
      // OneTrust writes OptanonConsent with default groups on page load; only OptanonAlertBoxClosed
      // proves the visitor (oho) actually made a choice.
      const closedAt = cookies.OptanonAlertBoxClosed;
      checks.push({
        name: 'OptanonConsent',
        ok: groups.length > 0 && bad.length === 0 && !!closedAt,
        detail: `${closedAt ? 'choice saved' : 'NO OptanonAlertBoxClosed (no choice recorded)'}; ${groups.length} groups, ON: [${on}]${bad.length ? ' ; refusable but ON: ' + bad : ''}${forced.length ? ` | always-active by site config (reported only): [${forced}]` : ''}`,
      });
    }
  }
  if (cmp === 'cookiebot') {
    const v = cookies.CookieConsent ?? '';
    const m = (k: string): string | undefined => new RegExp(`${k}:(true|false)`).exec(v)?.[1];
    const ok = !!v && m('necessary') === 'true' && ['preferences', 'statistics', 'marketing'].every((k) => m(k) === 'false');
    checks.push({ name: 'CookieConsent', ok: v ? ok : false, detail: v ? `necessary:${m('necessary')} preferences:${m('preferences')} statistics:${m('statistics')} marketing:${m('marketing')}` : 'cookie missing' });
  }
  if (cmp === 'didomi' && w.Didomi) {
    try {
      const s = w.Didomi.getUserStatus?.();
      if (s) {
        const pe: string[] = s.purposes?.consent?.enabled ?? [];
        const refused = new Set<string>(s.purposes?.consent?.disabled ?? []);
        const ve: string[] = s.vendors?.consent?.enabled ?? [];
        // A vendor still enabled only through site-defined essential purposes is fine;
        // one enabled for a refused or optional purpose is not.
        const purposesOf = (id: string): string[] => w.Didomi.getVendorById?.(id)?.purposeIds ?? [];
        const bad = ve.filter((id) => purposesOf(id).some((p) => refused.has(p) || pe.includes(p)));
        const lie = s.purposes?.legitimate_interest?.enabled ?? [];
        checks.push({
          name: 'Didomi.getUserStatus',
          ok: pe.length === 0 && bad.length === 0,
          detail: `consent purposes ON: [${pe}]; vendors ON for refused purposes: [${bad}]; essential-only vendors (reported only): ${ve.length - bad.length} | LI purposes ON (reported only): [${lie}]`,
        });
      } else {
        const a = w.Didomi.getUserConsentStatusForAll();
        const pe = a?.purposes?.enabled ?? [];
        checks.push({ name: 'Didomi.getUserConsentStatusForAll', ok: pe.length === 0, detail: `purposes enabled: [${pe}]` });
      }
    } catch (e) { checks.push({ name: 'Didomi', ok: null, detail: 'API error ' + e }); }
  }
  if (cmp === 'usercentrics') {
    try {
      if (w.__ucCmp?.getConsentDetails) {
        const d = await w.__ucCmp.getConsentDetails();
        const svc = Object.values(d?.services ?? {}) as any[];
        const on2 = svc.filter((x) => x?.consent?.given && !x?.essential).map((x) => x?.name ?? '?');
        const explicit = d?.consent?.type === 'EXPLICIT';
        checks.push({ name: '__ucCmp.getConsentDetails', ok: explicit && on2.length === 0, detail: `status=${d?.consent?.status} type=${d?.consent?.type} by=${d?.consent?.updatedBy}; ${svc.length} services, non-essential ON: [${on2.slice(0, 8)}]` });
      } else if (w.UC_UI?.getServicesBaseInfo) {
        const s = (await w.UC_UI.getServicesBaseInfo()) as any[];
        const on2 = s.filter((x) => x.consent?.status && !x.isEssential && x.categorySlug !== 'essential').map((x) => x.name);
        const hist = s.some((x) => (x.consent?.history ?? []).some((h: any) => h.type === 'explicit'));
        checks.push({ name: 'UC_UI.getServicesBaseInfo', ok: hist && on2.length === 0, detail: `${s.length} services; explicit choice=${hist}; non-essential ON: [${on2.slice(0, 8)}]` });
      }
    } catch (e) { checks.push({ name: 'usercentrics', ok: null, detail: 'API error ' + e }); }
  }
  if (cmp === 'trustarc') {
    const v = cookies.notice_preferences ?? cookies.notice_gdpr_prefs;
    checks.push({ name: 'notice_preferences', ok: v ? /^0[:|,]?:?$/.test(v.replace(/\s/g, '')) || /^0:/.test(v) : false, detail: v ? `value=${v}` : 'cookie missing' });
  }
  if (cmp === 'axeptio') {
    const v = cookies.axeptio_cookies;
    if (!v) checks.push({ name: 'axeptio_cookies', ok: false, detail: 'cookie missing' });
    else {
      try {
        const o = JSON.parse(v) as Record<string, unknown>;
        const yes = Object.entries(o).filter(([k, x]) => !k.startsWith('$$') && x === true).map(([k]) => k);
        // Axeptio writes an all-false cookie on load; only $$completed proves a choice was made.
        const done = o.$$completed === true;
        checks.push({ name: 'axeptio_cookies', ok: done && yes.length === 0, detail: `${done ? 'choice completed' : 'NO $$completed (default cookie, no choice)'}; vendors ON: [${yes}] ; authorized=${cookies.axeptio_authorized_vendors ?? '-'}` });
      } catch { checks.push({ name: 'axeptio_cookies', ok: null, detail: 'unparseable: ' + v.slice(0, 80) }); }
    }
  }
  if (cmp === 'iubenda') {
    // _iub_cs-<id> holds the purposes; _iub_cs-<id>-granular is an unrelated companion cookie.
    const k = Object.keys(cookies).find((x) => x.startsWith('_iub_cs-') && !x.endsWith('-granular'));
    if (!k) checks.push({ name: '_iub_cs', ok: false, detail: 'cookie missing' });
    else {
      try {
        const o = JSON.parse(cookies[k]!) as { purposes?: Record<string, boolean>; consent?: boolean };
        const yes = Object.entries(o.purposes ?? {}).filter(([p, x]) => x && p !== '1').map(([p]) => p);
        checks.push({ name: k, ok: o.purposes ? yes.length === 0 : o.consent === false, detail: JSON.stringify(o).slice(0, 160) });
      } catch { checks.push({ name: k, ok: null, detail: 'unparseable' }); }
    }
  }
  if (cmp === 'complianz') {
    const cats = ['marketing', 'statistics', 'preferences'].map((c) => [c, cookies['cmplz_' + c]] as const).filter(([, v]) => v);
    checks.push({ name: 'cmplz_*', ok: cats.length ? cats.every(([, v]) => v === 'deny') : false, detail: cats.length ? cats.map(([c, v]) => `${c}=${v}`).join(' ') : 'cookies missing' });
  }
  return checks;
};

export const slug = (url: string): string => new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
