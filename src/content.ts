import { RuleEngine, rulesFor, type Outcome } from './rules';
import { findCandidates } from './candidates';
import { run as runFallback } from './fallback';
import { dbg, timed } from './shared/dom';
import { DEFAULT_SETTINGS, ext, getSettings, isAllowed, type How, type Last, type Msg, type Settings } from './shared/ext';

const TOP = window === window.top;
const WATCH_MS = 10_000;
const DEBOUNCE_MS = 300;
/** Extra cheap rescans of dormant (hidden) candidates, for banners revealed without DOM insertions. */
const RECHECK_MS = [1500, 3000, 6000];

const engine = new RuleEngine(rulesFor(location.hostname, TOP, location.href));
const seen = new WeakSet<Element>();
let handled = false;
let busy = false;
let observer: MutationObserver | null = null;
let pending = 0;
/** Elements added since the last scan (null = scan the whole document). */
let added: Set<Element> | null = null;
let cmpSeen = false;
let settings: Settings = DEFAULT_SETTINGS;

/**
 * What a CMP iframe on this page reported (the background keeps the tab's last outcome).
 * Reports older than this document belong to a previous page in the same tab: ignored.
 */
const frameOutcome = (): Promise<How | null> =>
  ext.runtime.sendMessage({ type: 'oho_last' } satisfies Msg).then(
    (r: Last | null) => (r && typeof r.t === 'number' && r.t >= performance.timeOrigin ? r.how : null),
    () => null,
  );
const MAX_ADDED = 200;
let retries = 0;
/** Next scan looks at the whole page (set by a 'retry'; not reset by watch()). */
let fullRescan = false;
const MAX_RETRIES = 3;

function finish(id: string, how: Exclude<Outcome, 'retry'>): void {
  if (__DEBUG__) dbg('outcome', id, how ?? 'nothing (keep watching)');
  if (!how) return;
  handled = true;
  stop(`handled (${id}: ${how})`);
  if (how === 'frame') return; // the frame already reported (and counted) it
  const msg: Msg = { type: 'oho_done', id, how };
  ext.runtime.sendMessage(msg).catch(() => {});
}

function stop(why: string): void {
  if (__DEBUG__) dbg('stop', why, observer ? '' : '(observer already off)');
  observer?.disconnect();
  observer = null;
  clearTimeout(pending);
}

/** One pass: known CMPs first, then the heuristic fallback. All synchronous work is cheap and bounded. */
function scan(recheck = false): void {
  if (handled || busy) return;
  const batch = added && !fullRescan ? [...added] : undefined;
  added = new Set();
  fullRescan = false;
  // Once a CMP has been seen, keep doing the full (still cheap) presence check while it loads.
  const hit = timed(() => engine.detect(cmpSeen ? undefined : batch), 'detect');
  if (__DEBUG__) {
    const state = hit ? `${hit.rule.id} ${hit.visible ? 'visible' : 'present, hidden'}` : 'none';
    if (state !== lastDetect) dbg('detect', 'CMP:', state);
    lastDetect = state;
  }
  if (hit && hit.visible) {
    cmpSeen = true;
    busy = true;
    void engine.handle(hit.rule, { hideWalls: settings.hideWalls, frameOutcome }).then((how) => {
      busy = false;
      if (__DEBUG__ && (!how || how === 'retry')) dbg('rule', hit.rule.id, 'gave no outcome: heuristic gets the whole page');
      if (how && how !== 'retry') return finish(hit.rule.id, how);
      added = null; // rule failed: let the heuristic look at the whole page
      schedule(DEBOUNCE_MS);
    });
    return;
  }
  if (hit) {
    // CMP present but its UI is hidden: poll it, but don't block the heuristic meanwhile.
    // Live finding: marca.com / kicker.de load Didomi / Usercentrics but show their own wall.
    cmpSeen = true;
    schedule(500);
  }
  if (!TOP) return;
  const cands = timed(() => findCandidates(seen, batch, recheck), 'candidates');
  if (__DEBUG__ && cands.length) dbg('heuristic', `${cands.length} candidate(s)`, recheck ? '(dormant recheck)' : batch ? '(added nodes)' : '(full scan)');
  if (!cands.length) return;
  // The fallback is bundled in (no web-accessible resources, so pages can't probe for oho).
  // Its regexes still compile lazily, so pages without candidates never pay for them.
  const how = timed(() => runFallback(cands, seen, settings.hideWalls, retries >= MAX_RETRIES), 'fallback');
  if (__DEBUG__) dbg('heuristic', 'verdict:', how ?? 'not a banner / unsure');
  if (how === 'retry') {
    // A paid option is still fading in: look again at the whole page in a moment.
    retries++;
    fullRescan = true;
    return void schedule(700);
  }
  finish('heuristic', how);
}

let recheckDue = false;
let lastDetect = '';

function schedule(ms: number, recheck = false): void {
  if (handled) return;
  recheckDue ||= recheck;
  if (pending) return;
  pending = setTimeout(() => {
    pending = 0;
    const r = recheckDue;
    recheckDue = false;
    scan(r);
  }, ms) as unknown as number;
}

function watch(): void {
  added = new Set();
  observer = new MutationObserver((records) =>
    timed(() => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (added && added.size < MAX_ADDED) added.add(n as Element);
          else added = null; // too many: fall back to one full scan
        }
      }
      schedule(DEBOUNCE_MS);
    }, 'observer'),
  );
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Banners already in the DOM but hidden, then revealed by a class/style change, produce no
  // childList mutation: re-check the dormant candidates a few times (no document-wide query).
  for (const ms of RECHECK_MS) setTimeout(() => schedule(0, true), ms);
  setTimeout(() => stop(`timeout (${WATCH_MS / 1000} s watch window over, nothing handled)`), WATCH_MS);
  if (__DEBUG__) addEventListener('pagehide', () => observer && dbg('stop', 'observer disconnected: frame unloaded'));
}

async function allowed(): Promise<boolean> {
  if (TOP) {
    settings = await getSettings();
    return isAllowed(settings, location.hostname);
  }
  // Frames can't see the top-level host: ask the background, which knows the tab URL.
  const msg: Msg = { type: 'oho_check' };
  return ext.runtime.sendMessage(msg).then((r) => r === true, () => false);
}

async function main(): Promise<void> {
  // Several manifest entries can match one frame; they share this isolated world, so run once.
  const g = globalThis as { __ohoRan?: true };
  if (g.__ohoRan) return;
  g.__ohoRan = true;
  if (!TOP && !rulesFor(location.hostname, false, location.href).length) return;
  const ok = await allowed();
  if (__DEBUG__) dbg('start', location.href.slice(0, 100), 'allowed=' + ok, 'rules=' + rulesFor(location.hostname, TOP, location.href).map((r) => r.id).join(','));
  if (!ok) return;
  scan();
  if (!handled) watch();
}

void main();
