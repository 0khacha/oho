import { test as base, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';

const EXT = path.resolve('dist/chrome');
const BASE = 'http://127.0.0.1:4517/';
const ACCEPTISH = /accept|agree|allow|akzeptieren|قبول|acepto|ok pour moi|subscribe|sign in/i;

const test = base.extend<{ page: Page }, { ctx: BrowserContext; sw: Worker }>({
  ctx: [
    async ({}, use) => {
      const ctx = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
      });
      // Sourcepoint's message lives in a third-party iframe: serve the fixture on its real domain.
      await ctx.route('https://cdn.privacy-mgmt.com/**', (r) =>
        r.fulfill({ path: 'tests/fixtures/sourcepoint-frame.html', contentType: 'text/html' }),
      );
      // First-party CNAME message frames (live finding): matched by URL (consent_origin=), not domain.
      await ctx.route('https://cmpv2.news-example.test/**', (r) =>
        r.fulfill({ path: 'tests/fixtures/sourcepoint-frame.html', contentType: 'text/html' }),
      );
      await ctx.route('https://cmp.news-example.test/**', (r) =>
        r.fulfill({ path: 'tests/fixtures/sourcepoint-2step-frame.html', contentType: 'text/html' }),
      );
      await ctx.route('https://cmp.wall-example.test/**', (r) =>
        r.fulfill({ path: 'tests/fixtures/sourcepoint-wall-frame.html', contentType: 'text/html' }),
      );
      await use(ctx);
      await ctx.close();
    },
    { scope: 'worker' },
  ],
  sw: [
    async ({ ctx }, use) => {
      const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
      await use(sw);
    },
    { scope: 'worker' },
  ],
  page: async ({ ctx }, use) => {
    const page = await ctx.newPage();
    await use(page);
    await page.close();
  },
});

type State = { result: string | null; clicks: string[] };
const state = (page: Page): Promise<State> => page.evaluate(() => (window as any).__oho as State);

async function scrollable(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    window.scrollTo(0, 0);
    window.scrollTo(0, 400);
    await new Promise((r) => requestAnimationFrame(r));
    return window.scrollY > 0;
  });
}

async function setSettings(sw: Worker, s: { enabled: boolean; disabledSites: string[]; hideWalls?: boolean }): Promise<void> {
  await sw.evaluate((v) => chrome.storage.local.set({ oho_settings: v }), s);
}

const CMPS: [fixture: string, banner: string][] = [
  ['onetrust', '#onetrust-banner-sdk'],
  ['onetrust-prefs', '#onetrust-pc-sdk'],
  ['cookiebot', '#CybotCookiebotDialog'],
  ['didomi', '#didomi-notice'],
  ['quantcast', '#qc-cmp2-ui'],
  ['trustarc', '#truste-consent-track'],
  ['usercentrics', '[data-testid=uc-default-banner]'],
  ['sourcepoint', '#sp_message_container_1042'],
  ['axeptio', '#axeptio_overlay'],
  ['iubenda', '#iubenda-cs-banner'],
  ['complianz', '.cmplz-cookiebanner'],
  ['custom-fr', '#nb-42'], // unknown, appears after 1.2 s
  ['custom-ar', '#x7'], // unknown, Arabic RTL
  ['custom-reveal', '#pnl'], // unknown, pre-rendered hidden, revealed by class change
  // reproductions of live-site findings (tests/live/report.md)
  ['onetrust-late', '#onetrust-banner-sdk'], // handler wired after the button renders: retry
  ['axeptio-v2', '[data-testid=modal-container]'], // current Axeptio markup (ax-discardButton)
  ['iubenda-close', '#iubenda-cs-banner'], // "x" rejects when closeButtonRejects is configured
  ['sourcepoint-cname', '#sp_message_container_77'], // message frame on a first-party CNAME
  ['sourcepoint-2step', '#sp_message_container_88'], // reject behind "Tilpass eller avvis"
  ['usercentrics-v3', '#uc-main-dialog'], // v3 shadow DOM; floating privacy button is not a banner
  ['complianz-optout', '.cmplz-show'], // opt-out variant: no Deny, hidden Save
  ['complianz-api', '.cmplz-show'], // cmplz_deny_all() + dismissed status
  ['trustarc-notice', '#truste-consent-track'], // notice-only: More options -> Refuser tout
];

test.describe('rejects', () => {
  for (const [fx, banner] of CMPS) {
    test(fx, async ({ page }) => {
      await page.goto(BASE + fx + '.html');
      await expect.poll(async () => (await state(page)).result, { timeout: 8000 }).toBe('rejected');
      await expect(page.locator(banner)).toBeHidden();
      const s = await state(page);
      expect(s.clicks.filter((c) => ACCEPTISH.test(c) && !/sans accepter|selection/i.test(c))).toEqual([]);
      await expect.poll(() => scrollable(page)).toBe(true);
    });
  }
});

test('TrustArc shadow-DOM preference centre: refusal saved, backdrop cleared, page usable', async ({ page }) => {
  await page.goto(BASE + 'trustarc-notice.html');
  await expect.poll(async () => (await state(page)).result, { timeout: 10000 }).toBe('rejected');
  expect(await page.evaluate(() => document.cookie)).toContain('notice_preferences=0:');
  await expect(page.locator('.truste_cm_outerdiv')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('.truste_popframe')).toHaveCount(0);
  await expect.poll(() => scrollable(page), { timeout: 5000 }).toBe(true);
});

test("page-usable check leaves a site's own dialog (and its scroll lock) alone", async ({ page }) => {
  await page.goto(BASE + 'site-modal-after-reject.html');
  await expect.poll(async () => (await state(page)).result, { timeout: 8000 }).toBe('rejected');
  await page.waitForTimeout(2500);
  await expect(page.locator('#shop')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('hidden');
});

test('late-wired OneTrust button: first click ignored, oho retries', async ({ page }) => {
  await page.goto(BASE + 'onetrust-late.html');
  await expect.poll(async () => (await state(page)).result, { timeout: 8000 }).toBe('rejected');
  expect(await page.evaluate(() => (window as any).__ignoredClicks)).toBeGreaterThanOrEqual(1);
});

test('Usercentrics v3: the floating privacy button survives', async ({ page }) => {
  await page.goto(BASE + 'usercentrics-v3.html');
  await expect.poll(async () => (await state(page)).result, { timeout: 8000 }).toBe('rejected');
  await page.waitForTimeout(2000);
  await expect(page.locator('#uc-privacy-button')).toBeVisible();
});

/** The most recent outcome oho recorded for any tab (background storage.session). */
const lastOutcome = (sw: Worker): Promise<string | null> =>
  sw.evaluate(async () => {
    const all = await chrome.storage.session.get(null);
    const last = Object.entries(all)
      .filter(([k]) => k.startsWith('oho_last_'))
      .map(([, v]) => v as { how: string; t: number })
      .sort((a, b) => b.t - a.t)[0];
    return last?.how ?? null;
  });

// Pay-or-accept walls: left alone by default, hidden only when the user opts in.
const WALLS: [fixture: string, wall: string][] = [
  ['iubenda-paywall', '#iubenda-cs-banner'], // "Rifiuta e abbonati" (repubblica.it)
  ['paywall-hidden-cmp', '#ue-initial-modal'], // custom wall over a hidden Didomi (marca.com)
  ['sourcepoint-wall', '#sp_message_container_99'], // wall inside a cross-origin CMP frame (bild.de)
];
for (const [fx, wall] of WALLS) {
  test(`pay-or-accept wall, default (${fx}): left alone, reported as a wall`, async ({ page, sw }) => {
    await page.goto(BASE + fx + '.html');
    await expect.poll(() => lastOutcome(sw), { timeout: 8000 }).toBe('wall');
    await page.waitForTimeout(1000);
    await expect(page.locator(wall)).toBeVisible();
    expect(await page.locator('[data-oho-handled]').count()).toBe(0);
    const s = await state(page);
    expect(s.result).toBeNull();
    expect(s.clicks).toEqual([]);
  });
  test(`pay-or-accept wall, "hide walls" on (${fx}): hidden, scroll restored, nothing clicked`, async ({ page, sw }) => {
    try {
      await setSettings(sw, { enabled: true, disabledSites: [], hideWalls: true });
      await page.goto(BASE + fx + '.html');
      await expect(page.locator(wall)).toBeHidden({ timeout: 8000 });
      await expect.poll(() => scrollable(page)).toBe(true);
      const s = await state(page);
      expect(s.result).toBeNull();
      expect(s.clicks).toEqual([]);
    } finally {
      await setSettings(sw, { enabled: true, disabledSites: [] });
    }
  });
}

test('notice with no refuse button (custom-notice-es) is still hidden by default', async ({ page }) => {
  await page.goto(BASE + 'custom-notice-es.html');
  await expect(page.locator('#cookies-overlay')).toBeHidden({ timeout: 6000 });
  const s = await state(page);
  expect(s.result).toBeNull();
  expect(s.clicks).toEqual([]);
});

test('cookie wall without a reject button: hidden, scroll restored, accept never clicked', async ({ page }) => {
  await page.goto(BASE + 'custom-de.html');
  await expect(page.locator('#dlg')).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#wall')).toBeHidden();
  await expect.poll(() => scrollable(page)).toBe(true);
  const s = await state(page);
  expect(s.result).toBeNull();
  expect(s.clicks).toEqual([]);
});

for (const fx of ['no-banner-article', 'no-banner-app', 'heavy', 'busy', 'axeptio-widget-only']) {
  test(`no false positive: ${fx}`, async ({ page }) => {
    await page.goto(BASE + fx + '.html');
    await page.waitForTimeout(2500);
    const s = await state(page);
    expect(s.result).toBeNull();
    expect(s.clicks).toEqual([]);
    expect(await page.locator('[data-oho-handled]').count()).toBe(0);
    for (const sel of ['#newsletter', '#login', '#toast', '#toolbar', 'header', '#axeptio_main_button']) {
      if (await page.locator(sel).count()) await expect(page.locator(sel).first()).toBeVisible();
    }
  });
}

test('per-site allowlist and global switch are respected', async ({ page, sw }) => {
  try {
    await setSettings(sw, { enabled: true, disabledSites: ['127.0.0.1'] });
    await page.goto(BASE + 'onetrust.html');
    await page.waitForTimeout(1500);
    await expect(page.locator('#onetrust-banner-sdk')).toBeVisible();
    expect((await state(page)).clicks).toEqual([]);

    await setSettings(sw, { enabled: false, disabledSites: [] });
    await page.goto(BASE + 'iubenda.html');
    await page.waitForTimeout(1500);
    await expect(page.locator('#iubenda-cs-banner')).toBeVisible();
  } finally {
    await setSettings(sw, { enabled: true, disabledSites: [] });
  }
});

test('counters and popup', async ({ ctx, sw }) => {
  const stats = await sw.evaluate(() => chrome.storage.local.get('oho_stats'));
  expect((stats.oho_stats as { total: number }).total).toBeGreaterThanOrEqual(CMPS.length);
  const id = new URL(sw.url()).host;
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(popup.locator('h1')).toHaveText('oho');
  await expect(popup.locator('#total-count')).not.toHaveText('0');
  await expect(popup.locator('#enabled')).toBeChecked();
  await popup.close();
});
