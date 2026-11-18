import { MARK } from './shared/dom';

/** A possible banner root. Everything here was read in one batch; nothing has been written. */
export interface Cand {
  el: HTMLElement;
  rect: DOMRect;
  z: number;
  vw: number;
  vh: number;
}

/**
 * Targeted selectors only: we never walk the whole DOM. Typical pages match 5-30 elements;
 * from those we climb at most a few ancestors to find the fixed/sticky root.
 */
const SEL = [
  // Every substring selector costs ~0.35 ms per 25k nodes, so only the high-signal ones are kept.
  '[role=dialog]', '[role=alertdialog]', '[aria-modal=true]', 'dialog[open]',
  '[id*=cookie i]', '[class*=cookie i]', '[id*=consent i]', '[class*=consent i]', '[id*=gdpr i]', '[class*=gdpr i]',
  '[style*=fixed]',
].join(',');

/** Body children are read by iterating `body.children` (far cheaper than a `body>div` selector). */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'IMG', 'SVG', 'BR', 'MAIN', 'ARTICLE']);

const MAX_STYLE_READS = 80;
const MAX_CLIMB = 5;

/**
 * Fixed/sticky roots that were hidden when last seen (e.g. a pre-rendered banner waiting for
 * a class change). Incremental rescans re-check just these instead of the whole document.
 */
const dormant = new Set<HTMLElement>();
const MAX_DORMANT = 20;

/**
 * @param added When called from the MutationObserver, only these newly added subtrees are
 * searched, so rescans on busy pages cost O(added nodes), not O(document).
 * @param recheck Also re-check dormant roots (done on a few timers, not on every mutation).
 */
export function findCandidates(seen: WeakSet<Element>, added?: readonly Element[], recheck = false): Cand[] {
  const body = document.body;
  if (!body) return [];
  const html = document.documentElement;
  const vw = innerWidth;
  const vh = innerHeight;
  const vArea = vw * vh;
  const checked = new Set<Element>();
  const roots: { el: HTMLElement; cs: CSSStyleDeclaration }[] = [];
  let budget = MAX_STYLE_READS;

  const matches: HTMLElement[] = [];
  if (added) {
    if (recheck) {
      matches.push(...dormant);
      dormant.clear();
    }
    for (const e of added) {
      if (!e.isConnected || SKIP_TAGS.has(e.tagName.toUpperCase())) continue;
      // Deep insertions (feed items, list rows) are ignored unless they look like a banner:
      // reading their style would force a recalc on every mutation.
      if (e.parentElement === body || e.matches(SEL)) matches.push(e as HTMLElement);
      matches.push(...e.querySelectorAll<HTMLElement>(SEL));
    }
  } else {
    for (const e of body.children) if (!SKIP_TAGS.has(e.tagName.toUpperCase())) matches.push(e as HTMLElement);
    matches.push(...body.querySelectorAll<HTMLElement>(SEL));
  }
  for (let i = 0; i < matches.length && budget > 0; i++) {
    let el: HTMLElement | null = matches[i]!;
    for (let d = 0; el && el !== body && el !== html && d < MAX_CLIMB; d++, el = el.parentElement) {
      if (checked.has(el)) break;
      checked.add(el);
      budget--;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        roots.push({ el, cs });
        break;
      }
    }
  }

  const out: Cand[] = [];
  for (const { el, cs } of roots) {
    if (seen.has(el) || el.hasAttribute(MARK) || el.closest(`[${MARK}]`)) continue;
    // keep only outermost roots
    if (roots.some((r) => r.el !== el && r.el.contains(el))) continue;
    // Style check first: getBoundingClientRect forces layout, so only measure displayed elements.
    const hidden = cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05;
    const rect = hidden ? null : el.getBoundingClientRect();
    const w = rect ? Math.min(rect.right, vw) - Math.max(rect.left, 0) : 0;
    const h = rect ? Math.min(rect.bottom, vh) - Math.max(rect.top, 0) : 0;
    if (!rect || w <= 0 || h <= 0) {
      if (dormant.size < MAX_DORMANT) dormant.add(el);
      continue;
    }
    const areaRatio = (w * h) / vArea;
    const z = parseInt(cs.zIndex, 10) || 0;
    const nearEdge = rect.top <= 12 || rect.bottom >= vh - 12;
    if (areaRatio < 0.005) continue;
    if (z > 100 || areaRatio > 0.05 || nearEdge) out.push({ el, rect, z, vw, vh });
  }
  return out.slice(0, 6);
}
