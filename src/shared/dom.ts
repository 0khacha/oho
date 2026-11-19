import { PRICE, RE, norm } from './keywords';

export const MARK = 'data-oho-handled';

/** Visible text label of a clickable element (textContent: no layout cost). */
export function labelOf(el: Element): string {
  const e = el as HTMLInputElement;
  return norm(
    [e.textContent, e.getAttribute('aria-label'), e.getAttribute('title'), e.tagName === 'INPUT' ? e.value : '']
      .filter(Boolean)
      .join(' ')
      .slice(0, 200),
  );
}

/** Cheap visibility check. Only ever called on a handful of candidate elements. */
export function isVisible(el: Element | null | undefined): el is HTMLElement {
  if (!el || !(el as HTMLElement).isConnected) return false;
  const he = el as HTMLElement;
  if (typeof he.checkVisibility === 'function') {
    if (!he.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true } as CheckVisibilityOptions)) return false;
  } else {
    const cs = getComputedStyle(he);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
  }
  const r = he.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
}

/**
 * The single safety gate for every click oho makes.
 * - Anything that leads to paying ("subscribe", "abbonati", a price) is never clicked, even when it
 *   also says reject: pay-or-accept walls label their paid option "Reject and subscribe".
 * - Text that reads as "reject" is otherwise fine.
 * - Text that reads as "accept" is refused, unless it is a save button ("Allow selection")
 *   and the caller verified that every toggle was switched off first.
 * - Neutral text (an icon, "Save", "×") is allowed: callers only reach it through curated selectors.
 */
export function safeToClick(el: Element, verifiedSave = false): boolean {
  const t = labelOf(el);
  if (RE.pay.test(t) || PRICE.test(t)) return false;
  if (RE.reject.test(t)) return true;
  if (RE.accept.test(t)) return verifiedSave && RE.save.test(t);
  return true;
}

export function click(el: Element): void {
  (el as HTMLElement).click();
}

export function hide(el: Element): void {
  const s = (el as HTMLElement).style;
  if (!s) return;
  s.setProperty('display', 'none', 'important');
  el.setAttribute(MARK, 'hidden');
}

/** Undo the usual scroll locks left behind by a banner. Reads first, then writes. */
export function restoreScroll(lockClasses: readonly string[] = []): void {
  const html = document.documentElement;
  const body = document.body;
  const els = body ? [html, body] : [html];
  for (const c of lockClasses) els.forEach((e) => e.classList.contains(c) && e.classList.remove(c));
  const styles = els.map((e) => getComputedStyle(e));
  const bodyTop = body ? parseInt(body.style.top || '0', 10) : 0;
  styles.forEach((cs, i) => {
    const e = els[i]!;
    if (cs.overflowY === 'hidden' || cs.overflow === 'hidden') {
      e.style.setProperty('overflow-y', i === 0 ? 'auto' : 'visible', 'important');
    }
    if (i === 1 && cs.position === 'fixed') {
      e.style.setProperty('position', 'static', 'important');
      if (bodyTop < 0) window.scrollTo(0, -bodyTop);
    }
    if (cs.pointerEvents === 'none') e.style.setProperty('pointer-events', 'auto', 'important');
  });
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Debug builds (`node scripts/build.mjs --debug`) log decisions; compiled away otherwise. */
declare const __DEBUG__: boolean;
export function dbg(...a: unknown[]): void {
  if (__DEBUG__) console.log('[oho]', (window === window.top ? 'top' : 'frame ' + location.host), ...a);
}

/** Bench instrumentation: accumulates synchronous work time. Compiled away in release builds. */
declare const __BENCH__: boolean;
export function timed<T>(fn: () => T): T {
  if (!__BENCH__) return fn();
  const t = performance.now();
  try {
    return fn();
  } finally {
    const g = globalThis as unknown as { __ohoBench?: { ms: number; calls: number } };
    const b = (g.__ohoBench ??= { ms: 0, calls: 0 });
    b.ms += performance.now() - t;
    b.calls++;
  }
}
