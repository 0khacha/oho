# Firefox Add-ons (AMO) listing: oho

## Name
oho: Cookie Rejecter

## Add-on URL slug
oho-cookie-rejecter

## Summary (≤ 250 characters)
Automatically refuses cookie banners: clicks "Reject all", or switches every optional purpose off and saves. Never clicks "accept". Tiny, fast, private: no data collected, no network requests.

## Categories
Privacy & Security

## Description

oho (Tamazight for "no") says no to cookie banners for you.

Most "cookie blockers" only hide the banner, which leaves the website free to assume you agreed.
oho **refuses**:

- Where a site offers "Reject all", oho clicks it.
- Where refusing takes several steps, oho opens the preferences, switches every optional purpose off, checks that they stayed off, and saves.
- Where the consent platform has its own reject function, oho uses it.
- Where there is no way to refuse at all, oho hides the notice and restores scrolling.

oho never clicks anything that reads as "accept", and never anything that leads to paying.

**Supported consent platforms:** OneTrust, Cookiebot, Didomi, Quantcast / InMobi Choice, TrustArc,
Usercentrics, Sourcepoint, Axeptio, Iubenda, Complianz. Unknown banners are recognised by a tiny
built-in model that runs entirely in your browser.

**Pay-or-accept walls** ("accept cookies or subscribe") are left alone by default, because there is
no free way to refuse. The popup tells you when you hit one, and you can choose to hide them.

**Private by design:** oho runs on all sites to detect banners; everything is local, zero network
requests. No accounts, no analytics, no tracking. Open source.

## Data collection (`data_collection_permissions`)
`required: ["none"]`. oho collects and transmits no data.

## Permissions, as shown to users, with justification

| Permission | Why |
|---|---|
| Access your data for all websites | Cookie banners can appear on any site, so oho's detector must run on every page. It only looks at possible banners, stores nothing about pages, and makes zero network requests. |
| `storage` | Saves settings and two counters locally. |

Firefox lets users withhold website access from MV3 add-ons. If it is missing, oho's popup shows a
**Grant access** button.

## Notes for reviewers
- Source: <https://github.com/0khacha/oho>. Build with `npm install && npm run build`, which produces
  `oho-firefox.zip` (esbuild, minified; the unminified TypeScript source is in `src/`).
- `api.js` runs in the page's MAIN world. It listens for one DOM event from oho's content script and
  can only call a fixed list of consent platforms' own *reject* functions. Nothing from the event is
  evaluated.
- No remote code, no `eval`, no network requests.

## Privacy policy
Content of `PRIVACY.md`.

## Screenshots (1280×800)
- `store/screenshots/1-before.png`, `store/screenshots/2-after.png`, `store/screenshots/3-popup.png`
