# oho

> **oho** (Tamazight for *"no"*): auto-rejects cookie banners. Tiny, fast, private.

oho is a Manifest V3 browser extension for Chrome and Firefox. It **rejects** cookie consent banners
instead of just hiding them. Where a site offers "Reject all", oho clicks it. Where refusing takes
several steps, oho opens the preferences, switches every non-essential purpose off, and saves.
Where no way to refuse exists, oho hides the banner and gives you your scroll back. It never
clicks anything that reads as "accept".

- **18 KB** zipped, zero runtime dependencies (no frameworks, no ML runtimes, no WASM)
- **No network requests, no analytics, no data collection.** Everything runs locally.
- **1–6 ms** of main-thread work per page on the test fixtures (budget: 10 ms), never blocking page load

## Install

```sh
npm install
npm run build        # -> oho-chrome.zip, oho-firefox.zip (+ unpacked in dist/chrome, dist/firefox)
```

- **Chrome / Edge / Brave:** open `chrome://extensions`, enable *Developer mode*, then *Load unpacked*
  and pick `dist/chrome`. You can also upload `oho-chrome.zip` to the Chrome Web Store.
- **Firefox (128+):** open `about:debugging#/runtime/this-firefox`, choose *Load Temporary Add-on*
  and pick `dist/firefox/manifest.json`. To publish, sign `oho-firefox.zip` through AMO. Firefox
  asks you at install time to grant MV3 host permissions. oho needs them to run on pages.

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
   1. a visible **reject button**, then
   2. the CMP's own **JS reject API** (for example `Didomi.setUserDisagreeToAll()`), called through a
      tiny MAIN-world bridge (`src/api.ts`) that holds a fixed map of reject functions, then
   3. a **multi-step flow**: open preferences → uncheck everything non-essential → *verify* that
      it is all off → save, then
   4. as a last resort, **hiding** the banner and restoring scroll.
2. **Heuristic + tiny ML fallback (unknown banners).** A cheap candidate filter reads only the
   body's direct children plus one targeted `querySelectorAll` (`[role=dialog]`, `[aria-modal]`,
   `dialog[open]`, `[id/class*=cookie|consent|gdpr]`, `[style*=fixed]`). From those it climbs at most 5
   ancestors, capped at 80 style reads in total. A candidate must be fixed or sticky, visible, and
   either above z-index 100, covering more than 5% of the viewport, or touching the top or bottom
   edge. Most pages have 0–3 candidates. **Only when there is a candidate** is `fallback.js`
   lazy-loaded. It extracts 14 features, scores them with a logistic regression
   (`model/weights.json`; the prediction is about 10 lines in `src/model.ts`), and then:
   - if `p ≥ threshold` (0.7) and a button's text matches the reject keywords, it clicks that button;
   - if there is no reject button and `p ≥ hideThreshold` (0.85), it hides the banner and any
     full-screen backdrop, and restores scrolling;
   - otherwise it does nothing.
3. **Late banners.** A `MutationObserver` (debounced to 300 ms) looks **only at added subtrees**,
   so rescans on busy pages cost O(added nodes). Banners that were rendered hidden and are later
   revealed by a class change produce no mutation, so oho re-checks those "dormant" candidates at
   1.5 s, 3 s and 6 s. The observer disconnects once a banner is handled, or after 10 s.
4. **Iframes.** For CMPs that render inside a third-party frame (Sourcepoint, the TrustArc
   preference center), the content script also runs in `all_frames`, but **only** on those CMP
   domains. Frames ask the background page whether the top-level site is allowlisted.

### Safety: oho never accepts

Every click goes through one gate, `safeToClick` in `src/shared/dom.ts`:

- Text that matches the **reject** keywords is always allowed. Reject wins over accept, so
  *"continuer sans accepter"* counts as reject.
- Text that matches the **accept** keywords is refused. The only exception is a save button such
  as *"Allow selection"*, and only after the flow has switched every toggle off and checked that
  they all stayed off.
- Neutral text (an icon, "Save") is only clicked through curated CMP selectors, never by the heuristic.

The e2e tests make an "accepted" outcome sticky, so a single wrong click fails the test even if a
reject click comes after it.

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
- The ML module is lazy-loaded only when no CMP matched **and** a candidate exists.

## Repository layout

```
src/            TypeScript (strict), bundled by esbuild into one minified file per entry
  content.ts      entry: settings check, scan loop, observer
  rules.ts        rule engine (detect, reject, API, multi-step flows, hide)
  candidates.ts   cheap candidate filter (in the main bundle)
  fallback.ts     lazy-loaded heuristic (features + model + action)
  features.ts     feature extraction (shared with the dev collector)
  model.ts        logistic regression
  api.ts          MAIN-world bridge to CMP reject APIs
  background.ts   counters, allowlist answers for frames
  popup/          popup UI
  collector.ts    DEV ONLY dataset collector (not shipped)
rules/          cmps.json (CMP rules), keywords.json (EN/FR/AR/ES/DE)
model/          weights.json (hand-tuned initial weights)
training/       train.py (scikit-learn), requirements.txt, data/fixtures.csv seed set
tests/          fixtures/, e2e.spec.ts (Playwright), bench.mjs, server.mjs, dump-features.mjs
scripts/        build.mjs, icon.mjs (PNG icon renderer), zip.mjs (zip writer), all dependency-free
```

## How rules work

Each entry in `rules/cmps.json`:

| field | meaning |
|---|---|
| `id`, `name` | identifier / display name |
| `detect` | selector proving the CMP is on the page (comma list; prefer `#id` / `.class` / `body > …` for O(1) detection) |
| `visible` | selector that must be *visible* before acting (defaults to `detect`) |
| `shadow` | shadow-host selector; `visible`/`reject`/`flow` are then queried inside its open shadow root |
| `reject` | selector for the one-click reject button |
| `rejectText` | if true, the `reject` matches are filtered to those whose label matches the reject keywords |
| `api` | id of a reject function in `src/api.ts` (`onetrust`, `cookiebot`, `didomi`, `usercentrics`) |
| `flow` | multi-step steps, see below |
| `hide` | selectors to hide if the CMP doesn't close itself (or as the last resort) |
| `hideDelay` | ms to wait before hiding (gives the CMP or an iframe time to act) |
| `hideClasses` | scroll-lock classes to remove from `<html>`/`<body>` |
| `frame` | host suffixes: the rule runs **only** inside iframes on these domains |

Flow steps run in order. Each step waits for its element (2 s by default; 600 ms when `optional`).

```jsonc
{ "click": "#open-prefs" }                        // click the first visible match
{ "click": ".btn", "text": "reject", "done": true } // label must match a keyword category; ends the flow on success
{ "wait": "#prefs-panel" }                        // wait until visible
{ "uncheck": "#prefs input[type=checkbox]:not(:disabled)" } // switch all off (checkbox, role=switch, aria-pressed), then verify
{ "click": ".save", "save": true }                // save button; may read "Allow selection" only after a verified uncheck
```

A step that fails ends the flow, oho marks that rule as failed for the page, and the heuristic gets
a chance at it.

### Adding a CMP

1. Open a site that uses the CMP. Note the container id or class, the reject button, and (if there
   is no one-click reject) the preferences path.
2. Add a rule to `rules/cmps.json`. Rules are tried in order; put specific ones first.
3. Add a fixture `tests/fixtures/<cmp>.html` that mimics the markup. Use the harness:
   `ohoLock()` when the banner shows, and `ohoClose(el, 'rejected' | 'accepted')` in the button
   handlers. Then add `['<cmp>', '<banner selector>']` to `CMPS` in `tests/e2e.spec.ts`.
4. If the CMP renders in a third-party iframe, give the rule a `frame` list. The build adds those
   domains to the `all_frames` content-script matches. In the test, serve the frame with `ctx.route`
   (see the Sourcepoint example).
5. `npm run check` (typecheck + e2e + benchmark).

Keywords live in `rules/keywords.json` (`banner`, `reject`, `accept`, `settings`, `save`), one list
per category. Write them in lowercase. Longer phrases are matched first, and word boundaries work
for Latin and Arabic script.

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
npm test                          # build + 21 Playwright e2e tests with the real extension loaded
npm run bench                     # per-page execution time, fails if any fixture > 10 ms
npm run bench:mobile              # same at 4x CPU throttling (informational)
```

Fixtures: one per supported CMP, plus a OneTrust variant that needs the preferences flow; Cookiebot
uses the customize → uncheck → "Allow selection" flow and Didomi uses the JS API. There are 4 unknown
banners: French and late-injected, Arabic RTL, a German cookie wall with **no** reject button, and a
pre-rendered banner revealed by a class change. There are 4 pages without a banner: an article with a
sticky nav and a newsletter popup with "No thanks", a web app with an "Accept/Decline" invite, a toast
with "OK" and a login modal, a page with 25k elements, and a constantly mutating live feed.

The e2e tests check each of these things: the banner is gone, *reject* was recorded (never
*accept*), the page scrolls, the false-positive pages are untouched, the allowlist and global
switch are respected, and the popup and counters work.

## Results

**Bundle size** (`npm run build`):

| file | size |
|---|---|
| `content.js` | 18.4 KB |
| `fallback.js` (lazy) | 8.9 KB |
| `api.js` | 0.8 KB |
| `background.js` | 0.9 KB |
| `popup.js` | 1.1 KB |
| **`oho-chrome.zip`** | **18.1 KB** (37.7 KB unpacked) |
| **`oho-firefox.zip`** | **18.2 KB** (37.9 KB unpacked) |

**Benchmark** (`npm run bench`, Chromium headless on Windows 11, 5 runs per fixture). The numbers are
main-thread work summed over the whole page life, including script evaluation, the lazy fallback,
every observer rescan, and multi-step flows:

| fixture | median ms | max ms | outcome |
|---|---|---|---|
| axeptio | 1.30 | 1.50 | rejected |
| complianz | 1.40 | 1.60 | rejected |
| cookiebot (customize flow) | 2.30 | 2.80 | rejected |
| didomi (JS API) | 1.50 | 1.80 | rejected |
| iubenda | 2.10 | 2.50 | rejected |
| onetrust | 1.50 | 1.80 | rejected |
| onetrust-prefs (multi-step) | 2.90 | 3.40 | rejected |
| quantcast | 1.80 | 2.40 | rejected |
| sourcepoint (top frame) | 1.80 | 2.30 | hidden* |
| trustarc | 1.40 | 1.50 | rejected |
| usercentrics (shadow DOM) | 1.70 | 2.10 | rejected |
| custom-fr (late, unknown) | 3.00 | 4.50 | rejected |
| custom-ar (unknown, RTL) | 2.60 | 2.90 | rejected |
| custom-de (no reject button) | 2.70 | 3.20 | hidden |
| custom-reveal (class toggle) | 3.60 | 4.40 | rejected |
| no-banner-article | 2.70 | 3.00 | untouched |
| no-banner-app | 2.90 | 3.30 | untouched |
| heavy (25k elements) | 4.80 | 5.70 | untouched |
| busy (constant mutations) | 3.80 | 4.50 | untouched |

\* The bench runs only the top frame, so the Sourcepoint iframe is not loaded and oho falls back to
hiding. In the e2e test, the in-frame rule clicks "Reject all".

At **4× CPU throttling** (`npm run bench:mobile`, roughly a mid-range phone) costs scale about
linearly: known CMPs take 6–14 ms, unknown banners about 16 ms, and the 25k-element page about 32 ms.
The 10 ms budget is enforced at 1×.

## Privacy

oho makes no network requests. It has no analytics or telemetry and sends nothing anywhere.
It stores three things, all on your device: your settings (`chrome.storage.local`), a total
counter (`local`), and per-tab counters (`storage.session`, cleared when the tab closes).
Permissions: `storage`, plus `activeTab` so the popup can see the current site's hostname.

## Limitations

- CMP markup changes over time. The selectors in `rules/cmps.json` follow the public markup of
  each CMP and are tested against fixtures, not against live sites.
- Automated tests run on Chromium only. Firefox uses the same code and a generated manifest
  (`background.scripts`, `browser_specific_settings`), but it is not covered by the Playwright suite.
- `fallback.js` is a web-accessible resource, which lets pages detect that oho is installed in
  Chrome. Firefox randomises extension URLs per install, so this does not apply there.
- Banners that live in closed shadow roots, or in cross-origin iframes on domains oho doesn't
  list, are handled only by hiding (if a rule's `hide` covers them) or not at all.

## License

MIT
