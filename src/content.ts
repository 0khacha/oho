import { RuleEngine, rulesFor, type Outcome } from './rules';
import { findCandidates } from './candidates';
import { run as runFallback } from './fallback';
import { timed } from './shared/dom';
import { ext, getSettings, isAllowed, type Msg } from './shared/ext';

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
const MAX_ADDED = 200;

function finish(id: string, how: Outcome): void {
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
  const batch = added ? [...added] : undefined;
  added = new Set();
  // Once a CMP has been seen, keep doing the full (still cheap) presence check while it loads.
  const hit = timed(() => engine.detect(cmpSeen ? undefined : batch));
  if (hit && hit.visible) {
    cmpSeen = true;
    busy = true;
    void engine.handle(hit.rule).then((how) => {
      busy = false;
      if (how) return finish(hit.rule.id, how);
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
  finish('heuristic', timed(() => runFallback(cands, seen)));
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
  if (TOP) return isAllowed(await getSettings(), location.hostname);
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
  if (!(await allowed())) return;
  scan();
  if (!handled) watch();
}

void main();
