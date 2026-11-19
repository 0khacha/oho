import { RuleEngine, rulesFor, type Outcome } from './rules';
import { findCandidates } from './candidates';
import { run as runFallback } from './fallback';
import { dbg, timed } from './shared/dom';
import { DEFAULT_SETTINGS, ext, getSettings, isAllowed, type Last, type Msg, type Settings } from './shared/ext';

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

/** Ask the background whether a CMP iframe in this tab reported a pay-or-accept wall. */
const frameWall = (): Promise<boolean> =>
  ext.runtime.sendMessage({ type: 'oho_last' } satisfies Msg).then(
    (r: Last | null) => r?.how === 'wall',
    () => false,
  );
const MAX_ADDED = 200;
let retries = 0;
/** Next scan looks at the whole page (set by a 'retry'; not reset by watch()). */
let fullRescan = false;
const MAX_RETRIES = 3;

function finish(id: string, how: Exclude<Outcome, 'retry'>): void {
  dbg('finish', id, how);
  if (!how) return;
  handled = true;
  stop();
  const msg: Msg = { type: 'oho_done', id, how };
  ext.runtime.sendMessage(msg).catch(() => {});
}

function stop(): void {
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
  const hit = timed(() => engine.detect(cmpSeen ? undefined : batch));
  if (hit) dbg('detect', hit.rule.id, hit.visible ? 'visible' : 'hidden');
  if (hit && hit.visible) {
    cmpSeen = true;
    busy = true;
    void engine.handle(hit.rule, { hideWalls: settings.hideWalls, frameWall }).then((how) => {
      busy = false;
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
  const cands = timed(() => findCandidates(seen, batch, recheck));
  if (!cands.length) return;
  // The fallback is bundled in (no web-accessible resources, so pages can't probe for oho).
  // Its regexes still compile lazily, so pages without candidates never pay for them.
  const how = timed(() => runFallback(cands, seen, settings.hideWalls, retries >= MAX_RETRIES));
  if (how === 'retry') {
    // A paid option is still fading in: look again at the whole page in a moment.
    retries++;
    fullRescan = true;
    return void schedule(700);
  }
  finish('heuristic', how);
}

let recheckDue = false;

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
    }),
  );
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Banners already in the DOM but hidden, then revealed by a class/style change, produce no
  // childList mutation: re-check the dormant candidates a few times (no document-wide query).
  for (const ms of RECHECK_MS) setTimeout(() => schedule(0, true), ms);
  setTimeout(stop, WATCH_MS);
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
  dbg('start', location.href.slice(0, 80), 'allowed=' + ok, 'rules=' + rulesFor(location.hostname, TOP, location.href).map((r) => r.id).join(','));
  if (!ok) return;
  scan();
  if (!handled) watch();
}

void main();
