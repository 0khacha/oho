# Changelog

## 0.1.1 (2026-11-19)

Firefox Add-ons (AMO) submission prep. No change to what the extension does.

- `npm run source-zip` builds `oho-source.zip` from the committed source, for AMO's source review.
- `store/amo-reviewer-notes.md`: exact steps to rebuild `oho-firefox.zip` from that source.
- The Firefox manifest declares `data_collection_permissions: { required: ["none"] }`, and
  `web-ext lint` reports 0 errors and 0 warnings.
- Reproducible build: shipped text files are copied with LF line endings, and `.gitattributes`
  keeps checkouts LF. A Windows checkout no longer adds CRs to `popup.html` / `popup.css`.
  `oho-firefox.zip` is now 18.6 KB.
- Live reports are now named `report-non-eu.*`.
- Benchmark gate: a fixture fails if its median is over 10 ms or any single run is over 15 ms
  (was: any run over 10 ms, which failed on one-off spikes on a busy desktop). Max values are still
  reported.

## 0.1.0 (2026-11-19)

First public release.

### Features

- Rejects cookie banners automatically, in this order: the CMP's own reject button (with a check that
  the banner really closed, and one retry), the CMP's JS reject API, a multi-step flow (open
  preferences, switch every non-essential toggle off, verify, save), and only then hiding.
- Unknown banners: a cheap candidate filter plus a 14-feature logistic-regression model
  (`model/weights.json`) clicks a reject button when one exists, or hides the banner otherwise.
  Keywords in English, French, German, Spanish, Italian, Dutch, Danish, Norwegian, Swedish and Arabic.
- One safety gate for every click: anything that reads as paying is never clicked, accept text is
  refused, and a "save selection" button is allowed only after every toggle was verified off.
- Pay-or-accept walls are detected and left alone. An opt-in setting hides them instead.
- After every outcome, a page-usable check clears leftover CMP backdrops and scroll locks, but
  leaves a site's own dialog alone.
- Late and re-revealed banners: incremental `MutationObserver` rescans for 10 s, plus three cheap
  rechecks of hidden candidates.
- CMP iframes (Sourcepoint, including first-party CNAMEs, and TrustArc) are handled inside the frame.
  The top frame waits for the frame's own report before hiding anything.
- Popup with an on/off switch, per-site allowlist, the wall setting, and a counter.
- No network requests, no analytics, no data collection. Zero runtime dependencies.
- Chrome (MV3, 111+) and Firefox (140+, Android 142+) builds from one codebase.

### Supported CMPs

OneTrust, Cookiebot, Didomi, Quantcast / InMobi Choice, TrustArc, Usercentrics (v2 and v3 shadow
DOM), Sourcepoint, Axeptio, Iubenda, Complianz.

### Live results

52 real sites, tested from a non-EU location (no proxy, headless Chromium, `tests/live/report-non-eu.md`,
2026-11-19).
A banner appeared on 38:

- 38 of 38 handled correctly: 31 rejected, 1 notice with no way to refuse hidden, 6 pay-or-accept
  walls left alone. 0 missed, 0 failed, **0 accept clicks**.
- 31 of 31 refusals verified in the site's own storage. For 29 of them the check ran in the full
  run. The other 2, flysas.com (`_consent`) and fitx.de (`mandatory.*`), use banners of their own
  with no CMP, so they had no store check yet. Once checks were added, they were verified in
  3 of 3 solo reruns each.
- Sourcepoint, rerun alone with `--log`: finn.no rejected in 9 of 10 runs. The 10th was reported
  as "hidden", although the refusal was still recorded (TCF: no consents). Its log showed the
  cause: a slow privacy-manager frame lost a race against the top frame's hide timer. That is now
  fixed and covered by a fixture and a test. bild.de: a pay-or-accept wall, correctly left alone in
  5 of 5 runs.
- Not counted: 10 sites showed no banner outside the EU, 4 were blocked by the network or bot
  protection.

### Performance

- `oho-chrome.zip` 18.3 KB, `oho-firefox.zip` 18.7 KB.
- 36 test fixtures, 1.4–5.1 ms median main-thread work and at most 6.9 ms across 3 bench runs,
  against a 10 ms budget (table in the README).
- The candidate query was cut from 11 selectors to 7 (`[role$=dialog]` replaces two; `[aria-modal]`
  and the `gdpr` id/class selectors dropped): 2.8 → 1.9 ms cold on a 25k-node page.
- A curated reject button that the safety gate refuses ("Rifiuta e abbonati") is no longer re-polled
  for 1.5 s: iubenda-paywall went from 5.7 to 2.9 ms median.

### Known limitations

- Pay-or-accept walls record no refusal (none is offered for free), whether they are left alone or
  hidden.
- Banners in closed shadow roots, or in cross-origin iframes oho doesn't match, can only be hidden
  (if a rule covers them) or not handled at all.
- Rules follow CMP markup as of November 2026, and markup drifts.
