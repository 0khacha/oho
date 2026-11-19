# oho live report

Generated 2026-11-19T00:06:24.799Z - 1 sites - no proxy - headless

**NOT SHOWN**: 1

| site | CMP | result | time (ms) | notes |
|---|---|---|---|---|
| [ibm.com](https://www.ibm.com/) | trustarc | NOT SHOWN | - | MISS under concurrency 1; solo retry: NOT SHOWN<br>screenshot before.png failed: TimeoutError: page.screenshot: Timeout 10000ms exceeded.<br>diagnostic: banner first visible at never (in this pass); oho acted LATE, at 24298 ms (outside the 15 s window)<br>screenshot after.png failed: TimeoutError: page.screenshot: Timeout 10000ms exceeded.<br>banner appeared without oho but never in the oho pass: nothing to reject (the CMP did not render it)<br>notice_preferences ok: value=0: |

> **1 site(s) showed no banner.** Many CMPs only show banners to EU/EEA visitors.
> Re-run through an EU exit: `node tests/live/run.ts --proxy http://<eu-proxy>:<port>`.
