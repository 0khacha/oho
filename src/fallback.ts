/**
 * Heuristic + ML fallback for unknown banners. Bundled into content.js (nothing is
 * web-accessible), but only *runs* when the cheap candidate filter found something, and
 * its keyword regexes compile on first use.
 */
import type { Cand } from './candidates';
import { BTN_SEL, extract } from './features';
import { HIDE_THRESHOLD, THRESHOLD, score } from './model';
import { MARK, click, dbg, hide, isVisible, labelOf, restoreScroll, safeToClick, timed } from './shared/dom';
import { RE } from './shared/keywords';
import type { Outcome } from './rules';
import { isWall, payPending } from './walls';

function findReject(root: HTMLElement): HTMLElement | null {
  for (const btn of root.querySelectorAll<HTMLElement>(BTN_SEL)) {
    const l = labelOf(btn);
    // safeToClick also refuses "reject and subscribe" style buttons (live finding: marca.com).
    if (!l || l.length > 60 || !RE.reject.test(l) || !safeToClick(btn)) continue;
    if (btn.tagName === 'A') {
      const href = (btn.getAttribute('href') ?? '').trim();
      if (href && !/^(#|javascript:)/i.test(href)) continue; // would navigate away
    }
    if (isVisible(btn)) return btn;
  }
  return null;
}

/** Full-viewport layer with almost no text: a blocking backdrop. */
const isBackdrop = (c: Cand): boolean =>
  (c.rect.width * c.rect.height) / (c.vw * c.vh) > 0.5 && (c.el.textContent ?? '').trim().length < 30;

export function run(cands: Cand[], seen: WeakSet<Element>, hideWalls = false, final = false): Outcome {
  // ---- READ phase ----
  const scored = cands.map((c) => ({ c, p: score(extract(c)) })).sort((a, b) => b.p - a.p);
  for (const s of scored) if (s.p < THRESHOLD) seen.add(s.c.el);
  const best = scored[0];
  if (__DEBUG__ && best) dbg('heuristic', `best score ${best.p.toFixed(3)} (act >= ${THRESHOLD}, hide >= ${HIDE_THRESHOLD})`, `<${best.c.el.tagName.toLowerCase()}${best.c.el.id ? '#' + best.c.el.id : ''}>`);
  if (!best || best.p < THRESHOLD) return null;
  const el = best.c.el;
  const btn = findReject(el);
  // Pay-or-accept wall (accept or pay, no free refusal): left alone unless the user opted in.
  if (!btn && !hideWalls && isWall(el)) {
    seen.add(el);
    return 'wall';
  }
  if (!btn && !hideWalls && !final && payPending(el)) return 'retry';
  if (!btn && best.p < HIDE_THRESHOLD) {
    seen.add(el); // unsure: do nothing
    return null;
  }
  const backdrops = btn ? [] : cands.filter((c) => c !== best.c && isBackdrop(c));

  // ---- WRITE phase ----
  if (btn) {
    el.setAttribute(MARK, 'clicked');
    click(btn);
    setTimeout(
      () =>
        timed(() => {
          if (isVisible(el)) {
            hide(el);
            restoreScroll();
          }
        }),
      1000,
    );
    return 'rejected';
  }
  hide(el);
  backdrops.forEach((b) => hide(b.el));
  restoreScroll();
  return 'hidden';
}
