# Contributing to oho

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
rules/          cmps.json (CMP rules), keywords.json
model/          weights.json (hand-tuned initial weights)
training/       train.py (scikit-learn), requirements.txt, data/fixtures.csv seed set
tests/          fixtures/, e2e.spec.ts (Playwright), bench.mjs, server.mjs, dump-features.mjs
tests/live/     real-website harness: discover.ts, run.ts, inspect.ts, sites.json, report-non-eu.md
scripts/        build.mjs, icon.mjs (PNG icon renderer), zip.mjs (zip writer), all dependency-free
```

Build variants: `node scripts/build.mjs` (release + zips), `--bench` (timed bundle in `dist/bench`),
`--debug` (logs every decision to the console, unpacked in `dist/debug`), `--collector`.

## Performance rules

- No JS DOM walks: targeted queries only, with O(1) lookups where possible (`#id`, `.class`,
  iterating `body.children`). Every selector in a list is tested against every element, so the
  candidate query is kept short.
- `getComputedStyle` / `getBoundingClientRect` only on the bounded candidate set, style first, so
  hidden elements never force a layout. Reads are batched before writes.
- One RegExp per keyword category, compiled lazily on first use.
- Measure cold (a fresh page load), not warm: the two can disagree (see `src/candidates.ts`).

## Rules (`rules/cmps.json`)

| field | meaning |
|---|---|
| `id`, `name` | identifier / display name |
| `detect` | selector proving the CMP is on the page (prefer `#id` / `.class` / `body > …`) |
| `visible` | selector that must be *visible* before acting (defaults to `detect`); also how oho confirms the banner closed |
| `shadow` | shadow-host selector; `visible`/`reject`/`flow` are queried inside its open shadow root |
| `reject` | selector for the one-click reject button |
| `rejectText` | filter `reject` matches to labels that match the reject keywords |
| `api` | id of a reject function in `src/api.ts` (`onetrust`, `cookiebot`, `didomi`, `usercentrics`, `iubenda`, `complianz`) |
| `flow` | multi-step steps, see below |
| `hide` | selectors to hide if the CMP doesn't close itself (or as the last resort) |
| `hideDelay` | ms to wait before hiding (gives the CMP or an iframe time to act) |
| `hideClasses` | scroll-lock classes to remove from `<html>`/`<body>` |
| `frame` | host suffixes: the rule runs **only** inside iframes on these domains |
| `frameUrl` | the rule also runs in iframes whose URL contains this string (first-party CNAME frames) |
| `overlay` | CMP backdrops that can outlive the banner; cleared by the final page-usable check |
| `wallInFrame` | the banner's choices live in a cross-origin frame: wait for that frame's report before hiding |

Flow steps run in order. Each waits for its element (2 s by default, 600 ms when `optional`):

```jsonc
{ "click": "#open-prefs" }                        // click the first visible match
{ "click": ".btn", "text": "reject", "done": true } // label must match a keyword category; ends the flow
{ "wait": "#prefs-panel" }                        // wait until visible
{ "uncheck": "#prefs input[type=checkbox]:not(:disabled)" } // switch all off, then verify
{ "click": ".save", "save": true }                // may read "Allow selection" only after a verified uncheck
{ "click": ".save", "save": true, "hidden": true } // allow a non-displayed element (Complianz opt-out)
{ "click": ".declineAllButtonLower", "shadow": ".truste_popframe" } // inside an open shadow root
```

A failed step ends the flow, the rule is marked failed for the page, and the heuristic gets a chance.

Keywords live in `rules/keywords.json` (`banner`, `reject`, `accept`, `settings`, `save`, `pay`),
lowercase. Longer phrases match first; word boundaries work for Latin and Arabic script.

### Adding a CMP

1. Inspect a site that uses it: `node tests/live/inspect.ts <url> --no-oho --eval "…"`.
2. Add a rule to `rules/cmps.json` (rules are tried in order; specific ones first).
3. Add `tests/fixtures/<cmp>.html` using the harness (`ohoLock()` when shown,
   `ohoClose(el, 'rejected' | 'accepted')` in handlers) and add it to `CMPS` in `tests/e2e.spec.ts`.
4. For a third-party iframe, give the rule `frame` (or `frameUrl`) and serve the frame in the test
   with `ctx.route` (see the Sourcepoint examples).
5. `npm run check`, then `node tests/live/run.ts --only <host>`.

## Retraining the model

oho ships hand-tuned weights and works without training. To train your own:

1. `npm run build:collector`, paste `training/collector.js` into DevTools on a page, label each
   outlined candidate, and export with `ohoCollector.download()`. Put CSVs in `training/data/`.
   `npm run dataset:fixtures` builds a seed set from the fixtures.
2. ```sh
   pip install -r training/requirements.txt
   python training/train.py training/data/*.csv --dry-run   # cross-validated metrics
   python training/train.py training/data/*.csv             # writes model/weights.json
   ```
   Watch precision: a false positive means oho touches something that isn't a banner.
3. `npm run check`. New features go in `src/features.ts` and `model/weights.json`, then retrain.

## Live testing

Not part of `npm run check` (network, geo-targeting and bot protection make it flaky).

```sh
node tests/live/discover.ts    # probe candidate sites, detect each one's CMP -> sites.json
node tests/live/run.ts [--headed] [--proxy http://host:port] [--only host] [--concurrency 2] [--label name] [--log]
node tests/live/summary.mjs    # the headline numbers in the README
node tests/live/inspect.ts <url> [--no-oho] [--eval "<js>"] [--frames]
```

- Each site runs three passes: without oho (does a banner appear?), with oho (every click in every
  frame is recorded), and a reload with oho off (did the choice stick?). Screenshots and
  `result.json` go to `tests/live/results/<site>/`.
- Verification reads the stored choice: TCF `getTCData`, `OptanonConsent` + `OptanonAlertBoxClosed`,
  `CookieConsent`, Didomi `getUserStatus`, Usercentrics `getConsentDetails`, `notice_preferences`,
  `axeptio_cookies`, `_iub_cs-*`, `cmplz_*`, and for the custom banners flysas.com `_consent` and
  fitx.de `mandatory.*`. The page must still scroll with no CMP overlay covering it.
- Results: PASS (rejected and verified), HIDDEN (no way to refuse), WALL (pay-or-accept, left
  alone), MISS, FAIL (accept clicked, refusal not recorded, or page left blocked), NOT SHOWN, ERROR.
- A MISS is retried once, alone, with logging on.
- `--log` uses the debug build and writes `results/<site>/oho.log`: per frame, CMP detection, the
  rule chosen, each flow step and its timing, every click with its label and safety-gate verdict,
  and why the scan stopped (handled, timeout, frame unloaded).
- Reports: `report-non-eu.*` by default, `report-eu.*` with `--proxy`, `report-only.*` with `--only`
  (so a single-site run never overwrites the full report), `report-<name>.*` with `--label`.
