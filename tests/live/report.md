# oho live report

Generated 2026-11-18T19:28:24.188Z - 52 sites - no proxy - headless

**PASS**: 28 · **HIDDEN**: 7 · **NOT SHOWN**: 9 · **ERROR**: 3 · **FAIL**: 1 · **MISS**: 4

| site | CMP | result | time (ms) | notes |
|---|---|---|---|---|
| [jysk.dk](https://www.jysk.dk/) | onetrust | PASS | 3747 | OptanonConsent ok: choice saved; 4 groups, ON: [C0001] |
| [carrefour.fr](https://www.carrefour.fr/) | onetrust | PASS | 3104 | tcf ok: tcString set, status=useractioncomplete; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [], vendors 0<br>OptanonConsent ok: choice saved; 46 groups, ON: [C0048,C0132,C0001] \| always-active by site config (reported only): [C0048,C0132] |
| [rossmann.de](https://www.rossmann.de/de/) | onetrust | PASS | 4902 | OptanonConsent ok: choice saved; 6 groups, ON: [C0001] |
| [elcorteingles.es](https://www.elcorteingles.es/) | onetrust | PASS | 5263 | OptanonConsent ok: choice saved; 5 groups, ON: [C0001] |
| [yoast.com](https://yoast.com/) | onetrust | PASS | 3922 | OptanonConsent ok: choice saved; 4 groups, ON: [C0001] |
| [jyllands-posten.dk](https://jyllands-posten.dk/) | cookiebot | PASS | 2288 | tcf (n/a): gdprApplies=false (geo: TCF not in force)<br>CookieConsent ok: necessary:true preferences:false statistics:false marketing:false |
| [politiken.dk](https://politiken.dk/) | cookiebot | PASS | 5760 | tcf (n/a): gdprApplies=false (geo: TCF not in force)<br>CookieConsent ok: necessary:true preferences:false statistics:false marketing:false |
| [ekstrabladet.dk](https://ekstrabladet.dk/) | cookiebot | PASS | 2025 | tcf (n/a): gdprApplies=false (geo: TCF not in force)<br>CookieConsent ok: necessary:true preferences:false statistics:false marketing:false |
| [bt.dk](https://www.bt.dk/) | cookiebot | PASS | 4639 | tcf (n/a): gdprApplies=false (geo: TCF not in force)<br>CookieConsent ok: necessary:true preferences:false statistics:false marketing:false |
| [cookiebot.com](https://www.cookiebot.com/) | cookiebot | PASS | 2379 | CookieConsent ok: necessary:true preferences:false statistics:false marketing:false |
| [borsen.dk](https://borsen.dk/) | didomi | PASS | 1608 | tcf ok: tcString set, status=useractioncomplete; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [2,7,8,9,10,11], vendors 31<br>Didomi.getUserStatus ok: consent purposes ON: []; vendors ON for refused purposes: []; essential-only vendors (reported only): 1 \| LI purposes ON (reported only): [measure_ad_performance,improve_products,select_basic_ads,market_research,measure_content_performance,use_limited_data_to_select_content,analytics_tracking,functional] |
| [marmiton.org](https://www.marmiton.org/) | didomi | PASS | 4726 | refusal still stored after reload, but the site shows a dialog again (rule:didomi): typically "you refused: accept or subscribe"<br>tcf ok: tcString set, status=useractioncomplete; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [], vendors 17<br>Didomi.getUserStatus ok: consent purposes ON: []; vendors ON for refused purposes: []; essential-only vendors (reported only): 0 \| LI purposes ON (reported only): [] |
| [krone.at](https://www.krone.at/) | didomi | PASS | 3757 | refusal still stored after reload, but the site shows a dialog again (rule:didomi): typically "you refused: accept or subscribe"<br>tcf ok: tcString set, status=useractioncomplete; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [], vendors 0<br>Didomi.getUserStatus ok: consent purposes ON: []; vendors ON for refused purposes: []; essential-only vendors (reported only): 7 \| LI purposes ON (reported only): [] |
| [marca.com](https://www.marca.com/) | didomi | HIDDEN | 14368 | banner returns on reload (expected: nothing was refused)<br>tcf ok: tcString set, status=cmpuishown; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [], vendors 40<br>Didomi.getUserStatus ok: consent purposes ON: []; vendors ON for refused purposes: []; essential-only vendors (reported only): 0 \| LI purposes ON (reported only): [] |
| [france24.com](https://www.france24.com/ar/) | didomi | PASS | 1392 | tcf ok: tcString set, status=useractioncomplete; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [], vendors 3<br>Didomi.getUserStatus ok: consent purposes ON: []; vendors ON for refused purposes: []; essential-only vendors (reported only): 2 \| LI purposes ON (reported only): [] |
| [walesonline.co.uk](https://www.walesonline.co.uk/) | quantcast | NOT SHOWN | - | no banner appeared (probably geo-targeted to EU visitors)<br>tcf (n/a): gdprApplies=false (geo: TCF not in force) |
| [dailyrecord.co.uk](https://www.dailyrecord.co.uk/) | quantcast | NOT SHOWN | - | before: Error: page.goto: net::ERR_NAME_NOT_RESOLVED at https://www.dailyrecord.co.uk/<br>no banner appeared (probably geo-targeted to EU visitors)<br>tcf (n/a): gdprApplies=false (geo: TCF not in force) |
| [dailystar.co.uk](https://www.dailystar.co.uk/) | quantcast | ERROR | - | Error: page.goto: net::ERR_NAME_NOT_RESOLVED at https://www.dailystar.co.uk/ |
| [birminghammail.co.uk](https://www.birminghammail.co.uk/) | quantcast | ERROR | - | Error: page.goto: net::ERR_NAME_NOT_RESOLVED at https://www.birminghammail.co.uk/ |
| [chroniclelive.co.uk](https://www.chroniclelive.co.uk/) | quantcast | NOT SHOWN | - | no banner appeared (probably geo-targeted to EU visitors)<br>tcf (n/a): gdprApplies=false (geo: TCF not in force) |
| [redhat.com](https://www.redhat.com/en) | trustarc | FAIL | 12003 | page broken after oho: scrollable=true lock=false covered=#pop-outerdiv01186683927271669 |
| [ibm.com](https://www.ibm.com/) | trustarc | HIDDEN | 13075 | banner returns on reload (expected: nothing was refused) |
| [trustarc.com](https://www.trustarc.com/) | trustarc | PASS | 1993 | notice_preferences ok: value=0: |
| [oracle.com](https://www.oracle.com/) | trustarc | NOT SHOWN | - | no banner appeared (probably geo-targeted to EU visitors) |
| [netto.dk](https://netto.dk/) | usercentrics | PASS | 5787 | refusal still stored after reload, but the site shows a dialog again (rule:usercentrics): typically "you refused: accept or subscribe"<br>__ucCmp.getConsentDetails ok: status=ALL_DENIED type=EXPLICIT by=onDenyAllServices; 35 services, non-essential ON: [] |
| [thalia.de](https://www.thalia.de/) | usercentrics | PASS | 4458 | UC_UI.getServicesBaseInfo ok: 65 services; explicit choice=true; non-essential ON: []<br>html/body overflow:hidden but page still scrolls |
| [bilka.dk](https://www.bilka.dk/) | usercentrics | PASS | 6653 | refusal still stored after reload, but the site shows a dialog again (rule:usercentrics): typically "you refused: accept or subscribe"<br>__ucCmp.getConsentDetails ok: status=ALL_DENIED type=EXPLICIT by=onDenyAllServices; 45 services, non-essential ON: [] |
| [kicker.de](https://www.kicker.de/) | usercentrics | HIDDEN | 8923 | banner returns on reload (expected: nothing was refused) |
| [usercentrics.com](https://www.usercentrics.com/) | usercentrics | MISS | - | banner was shown (rule:usercentrics) but oho reported nothing<br>__ucCmp.getConsentDetails ok: status=ALL_DENIED type=EXPLICIT by=onDenyAllServices; 25 services, non-essential ON: [] |
| [dba.dk](https://www.dba.dk/) | sourcepoint | MISS | - | banner was shown (rule:sourcepoint) but oho reported nothing<br>tcf ok: tcString set, status=cmpuishown; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [2,7,9,10], vendors 7<br>html/body overflow:hidden but page still scrolls |
| [tagesspiegel.de](https://www.tagesspiegel.de/) | sourcepoint | HIDDEN | 9052 | banner returns on reload (expected: nothing was refused)<br>tcf ok: tcString set, status=cmpuishown; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [], vendors 0 |
| [liberation.fr](https://www.liberation.fr/) | sourcepoint | ERROR | - | blocked by bot protection / captcha (try --headed or a residential/EU proxy) |
| [finn.no](https://www.finn.no/) | sourcepoint | MISS | - | banner still visible (rule:sourcepoint)<br>tcf ok: tcString set, status=cmpuishown; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [7,9,10], vendors 5 |
| [bild.de](https://www.bild.de/) | sourcepoint | MISS | - | banner still visible (rule:sourcepoint)<br>tcf ok: tcString set, status=cmpuishown; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [], vendors 0 |
| [payfit.com](https://www.payfit.com/fr/) | axeptio | PASS | 10200 | axeptio_cookies ok: choice completed; vendors ON: [] ; authorized=,, |
| [welcometothejungle.com](https://www.welcometothejungle.com/fr) | axeptio | NOT SHOWN | - | no banner appeared (probably geo-targeted to EU visitors) |
| [malt.fr](https://www.malt.fr/) | axeptio | NOT SHOWN | - | no banner appeared (probably geo-targeted to EU visitors) |
| [ornikar.com](https://www.ornikar.com/) | axeptio | PASS | 4921 | axeptio_cookies ok: choice completed; vendors ON: [] ; authorized=,, |
| [axeptio.eu](https://www.axeptio.eu/fr/home) | axeptio | NOT SHOWN | - | no banner appeared (probably geo-targeted to EU visitors) |
| [aranzulla.it](https://www.aranzulla.it/) | iubenda | PASS | 2519 | tcf ok: tcString set, status=useractioncomplete; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [], vendors 21<br>_iub_cs-281842 ok: {"timestamp":"2026-11-18T19:26:25.728Z","version":"1.109.0","purposes":{"1":true,"2":false,"3":false,"4":false,"5":false},"id":281842,"cons":{"rand":"6184de","s<br>html/body overflow:hidden but page still scrolls |
| [tomshw.it](https://www.tomshw.it/) | iubenda | PASS | 3331 | tcf ok: tcString set, status=useractioncomplete; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [], vendors 21<br>_iub_cs-s3806744 ok: {"timestamp":"2026-11-18T19:26:36.141Z","version":"1.109.0","purposes":{"1":true,"2":false,"3":false,"4":false,"5":false},"id":69803975,"cons":{"rand":"e87641"} |
| [repubblica.it](https://www.repubblica.it/) | iubenda | HIDDEN | 5185 | banner returns on reload (expected: nothing was refused) |
| [iubenda.com](https://www.iubenda.com/it/) | iubenda | NOT SHOWN | - | no banner appeared (probably geo-targeted to EU visitors)<br>html/body overflow:hidden but page still scrolls |
| [ilpost.it](https://www.ilpost.it/) | iubenda | PASS | 6037 | tcf ok: tcString set, status=useractioncomplete; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [], vendors 21<br>_iub_cs-20939148 ok: {"timestamp":"2026-11-18T19:27:06.644Z","version":"1.109.0","purposes":{"1":true,"2":false,"3":false,"4":false,"5":false},"id":20939148,"cons":{"rand":"fece62"} |
| [wpmayor.com](https://wpmayor.com/) | complianz | PASS | 1348 | cmplz_* ok: marketing=deny statistics=deny preferences=deny |
| [wpzoom.com](https://www.wpzoom.com/) | complianz | PASS | 3431 | cmplz_* ok: marketing=deny statistics=deny preferences=deny |
| [really-simple-ssl.com](https://really-simple-ssl.com/) | complianz | NOT SHOWN | - | no banner appeared (probably geo-targeted to EU visitors) |
| [flysas.com](https://www.flysas.com/en/) | custom:unknown | PASS | 1546 | no consent store to verify; reload check passed |
| [fitx.de](https://www.fitx.de/) | custom:unknown | PASS | 6954 | no consent store to verify; reload check passed |
| [lemonde.fr](https://www.lemonde.fr/) | custom:unknown | HIDDEN | 1784 | banner returns on reload (expected: nothing was refused)<br>tcf (n/a): getTCData gave no answer |
| [xataka.com](https://www.xataka.com/) | custom:unknown | HIDDEN | 1391 | banner returns on reload (expected: nothing was refused) |
| [hdblog.it](https://www.hdblog.it/) | custom:unknown | PASS | 9442 | tcf ok: tcString set, status=useractioncomplete; purpose consents on: []; vendor consents on: 0 \| legitimate interest (reported only): purposes [], vendors 0 |

> **9 site(s) showed no banner.** Many CMPs only show banners to EU/EEA visitors.
> Re-run through an EU exit: `node tests/live/run.ts --proxy http://<eu-proxy>:<port>`.
