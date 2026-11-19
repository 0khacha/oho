<p align="center"><img src="assets/logo.svg" width="156" height="64" alt="oho"></p>

<h3 align="center">oho (Tamazight for "no")</h3>

<p align="center">Auto-rejects cookie banners. Tiny, fast, private.</p>

oho is a Manifest V3 browser extension for Chrome and Firefox. It **rejects** cookie consent banners
instead of just hiding them:
- where a site offers "Reject all", oho clicks it;
- where refusing takes several steps, oho opens the preferences, switches every non-essential
  purpose off, and saves;
- where there is no way to refuse at all, oho hides the notice and gives you your scroll back.

It never clicks anything that reads as "accept", and never anything that leads to paying.
Pay-or-accept walls are left alone unless you choose to hide them.

- **18.3 KB** zipped for Chrome (18.6 KB for Firefox), zero runtime dependencies.
- **No network requests, no analytics, no data collection** ([privacy policy](PRIVACY.md)).
- **1.7–6.0 ms** median main-thread work per page across 36 test fixtures (highest single run 8.1 ms), against a 10 ms median budget. It never blocks page load.
- **Live** (52 sites, a banner shown on 38): **38 of 38 banners handled correctly**, **0 accept
  clicks**. 31 rejected, all 31 refusals verified in the site's own storage; 1 notice hidden;
  6 pay-or-accept walls left alone.

Supported CMPs: OneTrust, Cookiebot, Didomi, Quantcast / InMobi Choice, TrustArc, Usercentrics,
Sourcepoint, Axeptio, Iubenda, Complianz. Unknown banners are handled by a heuristic and a small model.

## Install

```sh
npm install
npm run build        # -> oho-chrome.zip, oho-firefox.zip (+ unpacked in dist/chrome, dist/firefox)
```

- **Chrome / Edge / Brave:** `chrome://extensions` → *Developer mode* → *Load unpacked* → `dist/chrome`.
- **Firefox (140+):** `npm run firefox`, or `about:debugging#/runtime/this-firefox` → *Load Temporary
  Add-on* → `dist/firefox/manifest.json`. If Firefox withholds site access, the popup shows a
  **Grant access** button.

The popup has an on/off switch, *Disable on this site*, *Hide pay-or-accept walls* (off by
default), what happened on the current page, and two counters.

## How it works

The content script runs at `document_idle`:

1. **Known CMPs.** Cheap detection (`getElementById` / `getElementsByClassName` lookups). For a
   matched CMP, oho tries, in order: the **reject button** (and confirms the banner really closed),
   the CMP's own **JS reject API**, a **multi-step flow** (preferences → switch everything off →
   verify → save), and finally **hiding**. A page-usable check then clears leftover backdrops and
   scroll locks.
2. **Unknown banners.** A cheap candidate filter (body children plus one short selector query),
   14 features and a logistic regression. It clicks a reject button if one exists, hides a
   high-confidence banner without one, and otherwise does nothing.
3. **Late banners.** A `MutationObserver` looks only at added subtrees for 10 s, plus three cheap
   rechecks of hidden candidates.
4. **Iframes.** oho also runs inside known CMP frames (Sourcepoint, including first-party CNAMEs,
   and TrustArc), and only there. The top frame waits for the frame's report before hiding anything.

### Safety: oho never accepts, never subscribes

Every click goes through one gate, `safeToClick` in `src/shared/dom.ts`:
- anything that reads as **paying** ("subscribe", "abbonati", a price) is never clicked, even
  when it also says reject ("Rifiuta e abbonati");
- **reject** text is allowed, and reject wins over accept ("continuer sans accepter");
- **accept** text is refused. The only exception is a save button such as "Allow selection", and
  only after every toggle was switched off and verified.

The tests fail on any accept click, even one followed by a reject.

## Testing

```sh
npx playwright install chromium   # once
npm test                          # build + 46 Playwright e2e tests with the real extension
npm run bench                     # main-thread time per fixture: fails if a median > 10 ms or a run > 15 ms
npm run check                     # typecheck + test + bench
npm run check:firefox             # Firefox build in Playwright's Firefox
node tests/live/run.ts            # real websites (see CONTRIBUTING.md)
```

## Results

**Bundle:** `content.js` 26.4 KB, `oho-chrome.zip` 18.3 KB, `oho-firefox.zip` 18.6 KB.

**Benchmark** (`npm run bench`, Chromium headless, Windows 11, 5 runs per fixture). Main-thread work
summed over the whole page life. The gate fails a fixture whose **median** is over 10 ms, or any
single run over 15 ms: one run can spike on a busy desktop, so the max is reported but not gated at
10 ms. All 36 fixtures pass; the highest single run is 8.10 ms.

| fixture | median ms | max ms | outcome |
|---|---|---|---|
| onetrust | 3.20 | 3.40 | rejected |
| onetrust-prefs (multi-step) | 4.50 | 5.20 | rejected |
| cookiebot (customize flow) | 4.10 | 4.90 | rejected |
| didomi (JS API) | 2.90 | 3.30 | rejected |
| usercentrics-v3 (shadow DOM) | 3.10 | 3.20 | rejected |
| trustarc-notice (shadow-DOM flow + cleanup) | 4.40 | 4.50 | rejected |
| complianz-optout (hidden save) | 4.50 | 5.40 | rejected |
| sourcepoint-slowpm (top frame; slow CMP frame) | 1.80 | 2.30 | in-frame (e2e) |
| custom-fr (late, unknown) | 4.70 | 4.80 | rejected |
| custom-ar (unknown, RTL) | 3.60 | 3.90 | rejected |
| iubenda-paywall (wall, left alone) | 3.40 | 3.50 | untouched |
| no-banner-article | 4.00 | 5.10 | untouched |
| heavy (25k elements) | 6.00 | 8.10 | untouched |
| busy (constant mutations) | 5.20 | 5.60 | untouched |

**Resource use** (`npm run resources`, 10 fixture tabs open for 60 s, CDP sampling profiler;
[report](tests/resources-report.md)): oho's content scripts used 0.6–4.3 ms of CPU per tab, all of it
in the first 11 s, and **0 ms afterwards**, once the observer had disconnected. The service worker
used 2.7 ms while the tabs reported, then 0 ms, and Chrome stopped it as idle 37 s after the tabs
opened. oho adds about 300–420 KB of JS heap per tab.

**Live:** [`tests/live/report-non-eu.md`](tests/live/report-non-eu.md) (52 sites, tested from a non-EU location). Details of
each run are in the [changelog](CHANGELOG.md).

## Permissions

| Permission | Why oho needs it |
|---|---|
| `storage` | Your settings and two counters, on your device only. |
| Host access `http://*/*`, `https://*/*` | Banners can appear on any site; also lets the popup read the current tab's address for "Disable on this site". |

No `tabs`, `scripting`, `webRequest`, `cookies` or `<all_urls>`, and no remote code.

## Privacy

oho makes no network requests and sends nothing anywhere. It stores only your settings and
counters; per-tab values are cleared when the tab closes. See [PRIVACY.md](PRIVACY.md).

## Limitations

- Pay-or-accept walls record no refusal (none is offered for free), whether left alone or hidden.
- Banners in closed shadow roots, or in cross-origin iframes oho doesn't match, can only be hidden
  or not handled at all.

## Contributing

Rules, adding a CMP, retraining the model, and the live-test harness: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
