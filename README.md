<p align="center"><img src="assets/logo.svg" width="156" height="64" alt="oho"></p>

<p align="center"><b>oho</b> (Tamazight for <i>"no"</i>): auto-rejects cookie banners. Tiny, fast, private.</p>

oho is a Manifest V3 browser extension for Chrome and Firefox. It **rejects** cookie consent banners
instead of just hiding them. Where a site offers "Reject all", oho clicks it. Where refusing takes
several steps, oho opens the preferences, switches every non-essential purpose off, and saves.
Where no way to refuse exists, oho hides the banner and gives you your scroll back. It never
clicks anything that reads as "accept", and never anything that leads to paying.

- **17 KB** zipped, zero runtime dependencies (no frameworks, no ML runtimes, no WASM)
- **No network requests, no analytics, no data collection.** Everything runs locally.
- **1.5–7 ms** of main-thread work per page on the test fixtures (budget: 10 ms), never blocking page load
- **Verified on real sites:** 28 of 48 live sites rejected *and* the refusal confirmed in the CMP's own
  storage (see [Live testing](#live-testing-on-real-websites))

## Install

```sh
npm install
npm run build        # -> oho-chrome.zip, oho-firefox.zip (+ unpacked in dist/chrome, dist/firefox)
```

- **Chrome / Edge / Brave:** open `chrome://extensions`, enable *Developer mode*, then *Load unpacked*
  and pick `dist/chrome`. You can also upload `oho-chrome.zip` to the Chrome Web Store.
- **Firefox (140+):** `npm run firefox` builds and launches Firefox with oho loaded (needs Firefox
  installed). Or open `about:debugging#/runtime/this-firefox`, choose *Load Temporary Add-on*, and
  pick `dist/firefox/manifest.json`. To publish, sign `oho-firefox.zip` through AMO.
  `npm run lint:firefox` runs `web-ext lint` (0 errors, 0 warnings). Firefox lets users withhold
  MV3 site access; if it is missing, the popup shows a **Grant access** button.

The popup has a global on/off switch, a *Disable on this site* switch (kept in
`chrome.storage.local` as `oho_settings`), and two counters: banners handled on this tab, and
the total.

## How it works

The content script runs at `document_idle` and does the following, in this order:

1. **Rule engine (fast path).** It checks for known CMPs (OneTrust, Cookiebot, Didomi,
   Quantcast/InMobi Choice, TrustArc, Usercentrics, Sourcepoint, Axeptio, Iubenda, Complianz).
   Detect selectors are pre-split at startup: `#id` selectors use `getElementById`, `.class`
   selectors use `getElementsByClassName`, and `body > x` selectors scan only the body's children.
   On a page with no CMP, the check costs a few O(1) lookups. For a matched CMP, oho tries:
   1. a visible **reject button**. oho then **confirms the banner closed** and clicks again if it
      didn't: live CMPs often render the button before its click handler is attached;
   2. the CMP's own **JS reject API** (for example `Didomi.setUserDisagreeToAll()`), called through a
      tiny MAIN-world bridge (`src/api.ts`) that holds a fixed map of reject functions. Every function
      in it was confirmed to exist on live sites;
   3. a **multi-step flow**: open preferences → uncheck everything non-essential → *verify* that
      it is all off → save;
   4. as a last resort, **hiding** the banner and restoring scroll.
2. **Heuristic + tiny ML fallback (unknown banners).** A cheap candidate filter reads only the
   body's direct children plus one targeted `querySelectorAll` (`[role=dialog]`, `[aria-modal]`,
   `dialog[open]`, `[id/class*=cookie|consent|gdpr]`, `[style*=fixed]`). From those it climbs at most 5
   ancestors, capped at 80 style reads in total. A candidate must be fixed or sticky, visible, and
   either above z-index 100, covering more than 5% of the viewport, or touching the top or bottom
   edge. Most pages have 0–3 candidates. For each one, oho extracts 14 features and scores them with
   a logistic regression (`model/weights.json`; the prediction is about 10 lines in `src/model.ts`).
   Then:
   - if `p ≥ threshold` (0.7) and a button's text matches the reject keywords, it clicks that button;
   - if there is no reject button and `p ≥ hideThreshold` (0.85), it hides the banner and any
     full-screen backdrop, and restores scrolling;
   - otherwise it does nothing.

   The fallback also runs when a known CMP is loaded but its UI stays hidden: sites like marca.com
   load Didomi but show their own wall.
3. **Late banners.** A `MutationObserver` (debounced to 300 ms) looks **only at added subtrees**,
   so rescans on busy pages cost O(added nodes). Banners that were rendered hidden and are later
   revealed by a class change produce no mutation, so oho re-checks those "dormant" candidates at
   1.5 s, 3 s and 6 s. The observer disconnects once a banner is handled, or after 10 s.
4. **Iframes.** For CMPs that render inside a frame, the content script also runs in `all_frames`,
   but only where it can matter: on known CMP domains (`privacy-mgmt.com`, TrustArc), and in frames
   whose URL contains `consent_origin=`. That second case covers Sourcepoint's first-party CNAMEs
   (`cmp2.bild.de`, `cmpv2.dba.dk`, …) through `include_globs`, so the browser itself filters out
   ordinary iframes. Frames ask the background page whether the top-level site is allowlisted.

### Safety: oho never accepts, never subscribes

Every click goes through one gate, `safeToClick` in `src/shared/dom.ts`:

- Anything that reads as **paying** ("subscribe", "abbonati", "PUR-Abo", or a price) is never
  clicked, even when it also says reject. Pay-or-accept walls label their paid option
  *"Rifiuta e abbonati"* or *"Rechazo y me suscribo"*.
- Otherwise, text that matches the **reject** keywords is allowed. Reject wins over accept, so
  *"continuer sans accepter"* counts as reject.
- Text that matches the **accept** keywords is refused. The only exception is a save button such
  as *"Allow selection"*, and only after the flow has switched every toggle off and checked that
  they all stayed off.
- Neutral text (an icon, "Save") is only clicked through curated CMP selectors, never by the heuristic.

The e2e tests make an "accepted" outcome sticky, so a single wrong click fails the test even if a
reject click comes after it. The live runner treats any accept click as a hard FAIL.

### Performance rules followed

- The code never walks the DOM in JS. It uses targeted queries only, and replaces selectors with
  O(1) lookups where it can (`body>div` costs 1.4 ms on 25k nodes; iterating `body.children`
  costs 0.01 ms).
- `getComputedStyle` and `getBoundingClientRect` are called only on the bounded set of candidates.
  Style is checked first, so hidden elements never force a layout.
- Reads are batched before writes: the fallback scores every candidate before it clicks or hides
  anything.
- There is ONE combined RegExp per keyword category, compiled **lazily on first use**. The word
  boundaries use an explicit Latin+Arabic class instead of `\p{L}` with `/u`, which compiles about
  10× faster (0.5 ms vs 5 ms).
- Nothing is web-accessible: the fallback is bundled into `content.js`, so pages can't probe for
  oho. It costs nothing on pages without candidates, because its regexes compile lazily.

## Repository layout

```
src/            TypeScript (strict), bundled by esbuild into one minified file per entry
  content.ts      entry: settings check, scan loop, observer
  rules.ts        rule engine (detect, reject + confirm, API, multi-step flows, hide)
  candidates.ts   cheap candidate filter
  fallback.ts     heuristic (features + model + action)
  features.ts     feature extraction (shared with the dev collector)
  model.ts        logistic regression
  api.ts          MAIN-world bridge to CMP reject APIs
  background.ts   counters, allowlist answers for frames
  popup/          popup UI
  collector.ts    DEV ONLY dataset collector (not shipped)
rules/          cmps.json (CMP rules), keywords.json (EN/FR/AR/ES/DE + IT, DA/NO/SV)
model/          weights.json (hand-tuned initial weights)
training/       train.py (scikit-learn), requirements.txt, data/fixtures.csv seed set
tests/          fixtures/, e2e.spec.ts (Playwright), bench.mjs, server.mjs, dump-features.mjs
tests/live/     real-website harness: discover.ts, run.ts, inspect.ts, sites.json, report.md
scripts/        build.mjs, icon.mjs (PNG icon renderer), zip.mjs (zip writer), all dependency-free
assets/         logo.svg, mark.svg
```

## How rules work

Each entry in `rules/cmps.json`:

| field | meaning |
|---|---|
| `id`, `name` | identifier / display name |
| `detect` | selector proving the CMP is on the page (comma list; prefer `#id` / `.class` / `body > …` for O(1) detection) |
| `visible` | selector that must be *visible* before acting (defaults to `detect`); also how oho confirms the banner closed |
| `shadow` | shadow-host selector; `visible`/`reject`/`flow` are then queried inside its open shadow root |
| `reject` | selector for the one-click reject button |
| `rejectText` | if true, the `reject` matches are filtered to those whose label matches the reject keywords |
| `api` | id of a reject function in `src/api.ts` (`onetrust`, `cookiebot`, `didomi`, `usercentrics`, `iubenda`, `complianz`) |
| `flow` | multi-step steps, see below |
| `hide` | selectors to hide if the CMP doesn't close itself (or as the last resort) |
| `hideDelay` | ms to wait before hiding (gives the CMP or an iframe time to act) |
| `hideClasses` | scroll-lock classes to remove from `<html>`/`<body>` |
| `frame` | host suffixes: the rule runs **only** inside iframes on these domains |
| `frameUrl` | the rule also runs in iframes whose URL contains this string (first-party CNAME frames) |

Flow steps run in order. Each step waits for its element (2 s by default; 600 ms when `optional`).

```jsonc
{ "click": "#open-prefs" }                        // click the first visible match
{ "click": ".btn", "text": "reject", "done": true } // label must match a keyword category; ends the flow on success
{ "wait": "#prefs-panel" }                        // wait until visible
{ "uncheck": "#prefs input[type=checkbox]:not(:disabled)" } // switch all off (checkbox, role=switch, aria-pressed), then verify
{ "click": ".save", "save": true }                // save button; may read "Allow selection" only after a verified uncheck
{ "click": ".save", "save": true, "hidden": true } // allow a non-displayed element (Complianz opt-out banner)
```

A step that fails ends the flow, oho marks that rule as failed for the page, and the heuristic gets
a chance at it.

### Adding a CMP

1. Open a site that uses the CMP (`node tests/live/inspect.ts <url> --no-oho --eval "…"` helps).
   Note the container id or class, the reject button, and (if there is no one-click reject) the
   preferences path.
2. Add a rule to `rules/cmps.json`. Rules are tried in order; put specific ones first.
3. Add a fixture `tests/fixtures/<cmp>.html` that mimics the markup. Use the harness:
   `ohoLock()` when the banner shows, and `ohoClose(el, 'rejected' | 'accepted')` in the button
   handlers. Then add `['<cmp>', '<banner selector>']` to `CMPS` in `tests/e2e.spec.ts`.
4. If the CMP renders in a third-party iframe, give the rule a `frame` list (or a `frameUrl`). The
   build adds the matching content-script entries. In the test, serve the frame with `ctx.route`
   (see the Sourcepoint examples).
5. `npm run check` (typecheck + e2e + benchmark), then `node tests/live/run.ts --only <host>`.

Keywords live in `rules/keywords.json` (`banner`, `reject`, `accept`, `settings`, `save`, `pay`), one
list per category. Write them in lowercase. Longer phrases are matched first, and word boundaries
work for Latin and Arabic script.

## Retraining the model

oho ships hand-tuned weights (`"source": "hand-tuned"` in `model/weights.json`), so it works with
no training at all. To train your own:

1. **Collect data.** Run `npm run build:collector`, then paste `training/collector.js` into the
   DevTools console on a page (or wrap it in a bookmarklet). It outlines each candidate, asks
   *"Is this a cookie banner?"*, and keeps the rows in that site's `localStorage`. Run
   `ohoCollector.download()` to export `oho-dataset.csv`. Collect on many sites, with banners and
   without, and put the CSVs in `training/data/`.
   `npm run dataset:fixtures` builds a small auto-labelled seed set from the test fixtures.
2. **Train.**
   ```sh
   pip install -r training/requirements.txt
   python training/train.py training/data/*.csv --dry-run   # cross-validated metrics
   python training/train.py training/data/*.csv             # writes model/weights.json
   ```
   Feature order is read from the current `weights.json`, so it always matches `src/features.ts`.
   Watch the **precision**: a false positive means oho touches something that isn't a banner.
3. `npm run check`. The no-banner fixtures guard against false positives.

When you add a feature, add it to `FEATURES`/`extract()` in `src/features.ts` and to the
`features`/`weights` arrays in `model/weights.json`, then retrain.

## Testing

```sh
npx playwright install chromium   # once
npm test                          # build + 36 Playwright e2e tests with the real extension loaded
npm run bench                     # per-page execution time, fails if any fixture > 10 ms
npm run bench:mobile              # same at 4x CPU throttling (informational)
npm run check                     # typecheck + test + bench
```

Fixtures cover:
- one page per supported CMP, plus the variants that need a multi-step flow or a CMP API;
- reproductions of everything the live run found (see below), for example a OneTrust button whose
  handler is attached late, current Axeptio markup, Sourcepoint on a first-party CNAME, the
  Usercentrics v3 shadow DOM, the Complianz opt-out banner, Iubenda's "×" rejecting, the TrustArc
  notice, and pay-or-accept walls;
- unknown banners: French and late-injected, Arabic RTL, a German wall with no reject button, a
  banner revealed by a class change, and a Spanish notice-only bar;
- false-positive traps: a newsletter popup with "No thanks", an Accept/Decline invite, a toast with
  "OK", a login modal, a page with 25k elements, a constantly mutating feed, and an Axeptio
  settings button with no banner.

## Live testing on real websites

`npm run test:live` is deliberately **not** part of `npm run check`: it uses the network,
geo-targeting and bot protection make it flaky, and results drift as sites change.

```sh
node tests/live/discover.ts             # probe ~250 candidate sites, detect each one's CMP -> sites.json
node tests/live/run.ts [--headed] [--proxy http://host:port] [--only host] [--concurrency 3]
node tests/live/inspect.ts <url> [--no-oho] [--eval "<js>"] [--frames]   # debug one site
```

- **Discovery** never trusts memory: it identifies the CMP from scripts, network resources, globals
  and DOM, and keeps only unambiguous matches. It picks 5 per CMP, preferring sites where a banner
  was seen and spreading them across languages. It adds 5 sites whose banners match no supported CMP.
- **Each site** is run three times:
  1. a fresh profile **without** oho, to see whether a banner appears (`before.png`);
  2. a fresh profile **with** oho, recording every click in every frame (`after.png`);
  3. a reload with oho disabled, to see whether the choice stuck (`reload.png`).

  Screenshots go to `tests/live/results/<site>/`.
- **Verification** reads the CMP's own stored choice, not just "the banner is gone":
  - TCF `getTCData`: every purpose and vendor consent must be off (legitimate interest is reported);
  - OneTrust: `OptanonConsent` plus `OptanonAlertBoxClosed` (groups the site marks always-active are reported);
  - Cookiebot: `CookieConsent`;
  - Didomi: `getUserStatus` (vendors kept on only by site-defined essential purposes are reported);
  - Usercentrics: `getConsentDetails` must be `EXPLICIT`;
  - TrustArc: `notice_preferences`;
  - Axeptio: `axeptio_cookies` with `$$completed`;
  - Iubenda: `_iub_cs-*`;
  - Complianz: `cmplz_*`.
- **Results** fall into PASS, HIDDEN, MISS, FAIL, NOT SHOWN and ERROR. NOT SHOWN usually means the
  CMP only targets EU visitors: rerun with `--proxy`. Each run writes `tests/live/report.md` and
  `report.json`.

**Latest run** (48 sites, from a non-EU location, no proxy): **28 PASS**, 7 HIDDEN, 4 MISS, 1 FAIL,
9 NOT SHOWN, 3 ERROR, and no accept clicks anywhere.
- **HIDDEN:** these are pay-or-accept walls or notices with no way to refuse (kicker, marca,
  repubblica, tagesspiegel, lemonde, xataka, ibm).
- **The 4 MISSes, rerun one site at a time:** dba.dk passed 3/3 and usercentrics.com 2/2 (a third run
  hit a dropped connection). finn.no passed 4/6. In the one instrumented finn miss, Sourcepoint never
  rendered its banner in the oho pass, so there was nothing to reject. bild.de (a pay-or-accept wall)
  was hidden in 5/6 runs. Its one miss came from an uninstrumented run and its cause is not known. The
  runner now retries every MISS once, alone, before reporting it. It records when the banner first
  appeared, and reports "banner never shown in the oho pass" as NOT SHOWN, not MISS.
- **The FAIL:** redhat.com's TrustArc preference centre stays over the page after "Refuser tout".

## Results

**Bundle size** (`npm run build`):

| file | size |
|---|---|
| `content.js` (rule engine + fallback) | 23.5 KB |
| `api.js` | 1.1 KB |
| `background.js` | 1.0 KB |
| `popup.js` | 1.4 KB |
| **`oho-chrome.zip`** | **16.7 KB** (35.9 KB unpacked) |
| **`oho-firefox.zip`** | **16.8 KB** (36.2 KB unpacked) |

**Benchmark** (`npm run bench`, Chromium headless on Windows 11, 5 runs per fixture). The numbers are
main-thread work summed over the whole page life, including script evaluation, every observer
rescan, and multi-step flows. All 32 fixtures pass the 10 ms budget. A selection:

| fixture | median ms | max ms | outcome |
|---|---|---|---|
| onetrust | 1.90 | 2.10 | rejected |
| onetrust-late (retry) | 2.90 | 3.30 | rejected |
| onetrust-prefs (multi-step) | 3.40 | 4.20 | rejected |
| cookiebot (customize flow) | 3.30 | 3.40 | rejected |
| didomi (JS API) | 2.20 | 3.10 | rejected |
| usercentrics-v3 (shadow DOM) | 1.70 | 1.90 | rejected |
| complianz-optout (hidden save) | 3.30 | 4.00 | rejected |
| custom-fr (late, unknown) | 3.70 | 3.80 | rejected |
| custom-ar (unknown, RTL) | 2.70 | 3.10 | rejected |
| iubenda-paywall (pay-or-accept) | 4.10 | 4.60 | hidden |
| no-banner-article | 2.90 | 3.30 | untouched |
| heavy (25k elements) | 6.00 | 7.30 | untouched |
| busy (constant mutations) | 3.90 | 4.60 | untouched |

The bench runs only the top frame, so Sourcepoint fixtures show "hidden" there. In the e2e tests,
the in-frame rule clicks "Reject all".

At **4× CPU throttling** (`npm run bench:mobile`, roughly a mid-range phone) costs scale about
linearly. The 10 ms budget is enforced at 1×.

## Privacy

oho makes no network requests. It has no analytics or telemetry and sends nothing anywhere.
It stores four things, all on your device: your settings (`chrome.storage.local`), a total
counter (`local`), and per-tab counters plus the last outcome per tab (`storage.session`, cleared
when the tab closes). Permissions: `storage`, `activeTab`, and host access to web pages (needed for
the content scripts).

## Limitations

- CMP markup changes over time. The rules were checked against live sites in November 2026, from a
  non-EU location, so EU-only banner variants are less covered.
- Automated tests run on Chromium only. Firefox uses the same code and a generated manifest, which
  passes `web-ext lint`, but it is not covered by the Playwright suite.
- Pay-or-accept walls (refuse only by subscribing) are hidden, not answered: no refusal is recorded.
- Banners that live in closed shadow roots, or in cross-origin iframes oho doesn't match, are
  handled only by hiding (if a rule's `hide` covers them) or not at all.

## License

MIT
