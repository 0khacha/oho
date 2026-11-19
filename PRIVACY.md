# oho privacy policy

*Last updated: 2026-11-18*

oho ("oho: Cookie Rejecter") is a browser extension that refuses cookie consent banners for you.
This policy covers the extension as published from this repository.

## The short version

**oho collects no data.** It sends nothing anywhere, has no servers, no accounts, no analytics,
no telemetry, and no third-party code. Everything happens inside your browser.

## What oho does on the pages you visit

To find cookie banners, oho's content script runs on every web page you open. It looks only at
elements that could be a consent banner (for example fixed-position dialogs, or elements whose
id or class mentions "cookie" or "consent") and at the labels of their buttons. It then clicks
the banner's own "reject" control, or hides the banner if there is no way to refuse.

None of that page content is stored, logged or transmitted. oho does not read form fields,
passwords, your browsing history, or page text beyond the banner it is handling.

## Network requests

oho makes **zero** network requests. It contains no remote code and loads nothing from the
internet. The only effect of a click oho makes is whatever the website's own consent banner does
when you refuse (usually: saving your refusal in the site's own cookie).

## What oho stores, and where

oho stores a few small values with the browser's extension storage API, **only on your device**.
They are never synced or sent anywhere.

| Key | Storage | Contents | Why |
|---|---|---|---|
| `oho_settings` | `storage.local` | on/off switch, list of sites you disabled oho on, the "hide pay-or-accept walls" choice | to remember your settings |
| `oho_stats` | `storage.local` | one number: how many banners oho has handled in total | the "total" counter in the popup |
| `oho_tab_<id>` | `storage.session` | how many banners oho handled in a tab | the "on this tab" counter |
| `oho_last_<id>` | `storage.session` | the last outcome in a tab (for example "rejected", or "pay-or-accept wall") | so the popup can tell you what happened on the current page |

The `storage.session` values are deleted automatically when the tab closes or the browser quits.
Uninstalling oho deletes all of them.

## Permissions

- **`storage`**: save the settings and counters listed above.
- **Access to websites (`http://*/*`, `https://*/*`)**: run the banner detector on the pages you
  visit. Banners can appear on any site, so oho cannot know in advance where it is needed.

## Children

oho collects no personal information from anyone, including children.

## Changes

If this policy changes, the new version will be published in this file, with a new date above.

## Contact

Open an issue at <https://github.com/0khacha/oho/issues>.
