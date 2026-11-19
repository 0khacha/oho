# Chrome Web Store listing: oho

## Name
oho: Cookie Rejecter

## Short description (≤ 132 characters)
Automatically refuses cookie banners: clicks "Reject all" for you. Tiny, fast, private. No data collected, no network requests.

<!-- 127 characters -->

## Category
Productivity (alternative: Privacy & Security)

## Language
English (the extension handles banners in English, French, Arabic, Spanish, German, Italian, Danish, Norwegian and Swedish)

## Full description

oho (Tamazight for "no") says no to cookie banners for you.

Most "cookie blockers" just hide the banner, which leaves the website free to assume you agreed.
oho REFUSES:

• Where a site offers "Reject all", oho clicks it.
• Where refusing takes several steps, oho opens the preferences, switches every optional purpose off, checks that they stayed off, and saves.
• Where the consent platform has its own reject function, oho uses it.
• Where there is no way to refuse at all, oho hides the notice and gives you your scrolling back.

oho never clicks anything that reads as "accept", and never anything that leads to paying.

Supported consent platforms: OneTrust, Cookiebot, Didomi, Quantcast / InMobi Choice, TrustArc,
Usercentrics, Sourcepoint, Axeptio, Iubenda and Complianz. Unknown banners are recognised by a tiny
built-in model that runs entirely in your browser.

Pay-or-accept walls ("accept cookies or subscribe") are left alone by default, because there is no
free way to refuse. The popup tells you when you hit one, and you can choose to hide them.

Tiny and fast: about 18 KB, zero dependencies, a few milliseconds of work per page.

Private by design: oho runs on all sites to detect banners; everything is local, zero network requests.
No accounts, no analytics, no tracking. The source code is public.

Popup: on/off switch, "disable on this site", "hide pay-or-accept walls", and counters for the
current tab and in total.

## Single purpose
oho has one purpose: to answer cookie consent banners with a refusal on the pages the user visits
(or to hide them when no refusal is possible), so the user does not have to.

## Permission justifications

| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings (on/off, sites where oho is disabled, the pay-or-accept wall choice) and two counters, locally on the device. |
| Host permissions `http://*/*`, `https://*/*` | Cookie banners can appear on any website, so the content script must run on all sites to detect and refuse them. Runs on all sites to detect banners; everything is local, zero network requests. |

## Remote code
No. All code is packaged in the extension. oho loads no remote scripts and makes no network requests.

## Data usage (privacy practices tab)
- Collects no user data in any of the listed categories.
- Does not sell or transfer data to third parties.
- Does not use or transfer data for purposes unrelated to the single purpose.
- Does not use or transfer data to determine creditworthiness or for lending.

## Privacy policy URL
https://0khacha.github.io/oho/PRIVACY (from `PRIVACY.md`, once GitHub Pages is enabled)

## Screenshots (1280×800)
- `store/screenshots/1-before.png`: a page with a cookie banner
- `store/screenshots/2-after.png`: the same page after oho refused it
- `store/screenshots/3-popup.png`: the popup
