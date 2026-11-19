import data from '../rules/cmps.json';
import { RE, type Category } from './shared/keywords';
import { MARK, click, dbg, hide, isVisible, labelOf, restoreScroll, safeToClick, sleep, timed } from './shared/dom';
import { isWall } from './walls';

export interface Step {
  click?: string;
  wait?: string;
  uncheck?: string;
  /** Keyword category the element's label must match (e.g. "reject", "settings"). */
  text?: Category;
  optional?: boolean;
  /** Flow ends successfully after this click. */
  done?: boolean;
  /** Save button: may read like "Allow selection", allowed only after a verified uncheck step. */
  save?: boolean;
  /** Allow a non-displayed element (e.g. Complianz's opt-out banner keeps "Save" hidden). */
  hidden?: boolean;
  /** Query inside this host's open shadow root (TrustArc's new preference centre). */
  shadow?: string;
  timeout?: number;
}

export interface Rule {
  id: string;
  name: string;
  detect: string;
  visible?: string;
  shadow?: string;
  reject?: string;
  rejectText?: boolean;
  api?: string;
  flow?: Step[];
  hide?: string;
  hideDelay?: number;
  hideClasses?: string[];
  /** CMP backdrops/overlays that may outlive the banner; always cleared once oho is done. */
  overlay?: string;
  /** The banner's buttons live in a cross-origin iframe: ask the frame whether it is a wall. */
  wallInFrame?: boolean;
  frame?: string[];
  /** Also run in iframes whose URL contains this string (first-party CNAME CMP frames). */
  frameUrl?: string;
}

/**
 * 'retry': not decidable yet (a paid option is still fading in); rescan shortly.
 * 'frame': a CMP iframe already handled the banner and reported it; the top frame stops quietly.
 */
export type Outcome = 'rejected' | 'hidden' | 'wall' | 'retry' | 'frame' | null;

export interface HandleOptions {
  /** Hide pay-or-accept walls (user setting, off by default). */
  hideWalls: boolean;
  /** What a CMP iframe on this page reported, if anything (Sourcepoint works cross-origin). */
  frameOutcome: () => Promise<'rejected' | 'hidden' | 'wall' | null>;
}

/**
 * How long the top frame waits for a CMP iframe that is still working before hiding its container
 * (polls of 500 ms, after `hideDelay`). Live finding (finn.no, oho.log): Sourcepoint's privacy
 * manager is a second iframe that sometimes needs ~7 s to show "Avvis alle"; the old 3.5 s window
 * hid the container first, so the refusal was reported as "hidden".
 */
const FRAME_POLLS = 16;

const RULES = (data as { cmps: Rule[] }).cmps;

const hostMatch = (host: string, d: string): boolean => host === d || host.endsWith('.' + d);

export function rulesFor(host: string, top: boolean, href = ''): Rule[] {
  return RULES.filter((r) =>
    top ? !r.frame : !!r.frame?.some((d) => hostMatch(host, d)) || (!!r.frameUrl && href.includes(r.frameUrl)),
  );
}

type Root = Document | ShadowRoot | Element;

function scope(rule: Rule): Root {
  if (!rule.shadow) return document;
  const host = document.querySelector(rule.shadow);
  return host?.shadowRoot ?? host ?? document;
}

/** First visible element matching `sel` (and, optionally, whose label matches a keyword category). */
function find(root: Root, sel: string | undefined, text?: Category, allowHidden = false): HTMLElement | null {
  if (!sel) return null;
  for (const el of root.querySelectorAll(sel)) {
    if (el.closest(`[${MARK}]`)) continue;
    if (text && !RE[text].test(labelOf(el))) continue;
    if (allowHidden ? el.isConnected : isVisible(el)) return el as HTMLElement;
  }
  return null;
}

const isOn = (e: Element): boolean =>
  e instanceof HTMLInputElement
    ? e.checked
    : e.getAttribute('aria-checked') === 'true' || e.getAttribute('aria-pressed') === 'true';

/** Switch every matched toggle off, then verify. Returns false if anything stays on. */
function uncheckAll(root: Root, sel: string): boolean {
  const els = [...root.querySelectorAll(sel)].filter((e) => e.getAttribute('aria-disabled') !== 'true');
  const on = els.filter(isOn);
  on.forEach((e) => (e as HTMLElement).click());
  for (const e of on) {
    if (isOn(e) && e instanceof HTMLInputElement) {
      e.checked = false;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  return els.every((e) => !isOn(e));
}

async function waitFor<T>(fn: () => T | null, timeout: number): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = timed(fn, 'wait');
    if (v || Date.now() >= end) return v;
    await sleep(100);
  }
}

/** Ask the MAIN-world bridge (api.ts) to call the CMP's own reject API. Synchronous round-trip via DOM events. */
function callApi(id: string): boolean {
  let ok = false;
  const on = (e: Event): void => {
    const d = String((e as CustomEvent).detail);
    if (d === id + ':1') ok = true;
  };
  document.addEventListener('oho:api-done', on);
  document.dispatchEvent(new CustomEvent('oho:api', { detail: id }));
  document.removeEventListener('oho:api-done', on);
  return ok;
}

/** Where a flow step looks: the rule's scope, or a specific shadow root. */
function stepRoot(rule: Rule, step: Step): Root | null {
  if (!step.shadow) return scope(rule);
  const host = document.querySelector(step.shadow);
  return host ? (host.shadowRoot ?? host) : null;
}

async function runFlow(rule: Rule): Promise<boolean> {
  let verified = false;
  const steps = rule.flow ?? [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const timeout = step.timeout ?? (step.optional ? 600 : 2000);
    const t0 = __DEBUG__ ? performance.now() : 0;
    const log = (what: string): void => {
      if (__DEBUG__) dbg('flow', rule.id, `step ${i + 1}/${steps.length}`, step.wait ? 'wait' : step.click ? 'click' : 'uncheck', JSON.stringify(step.wait ?? step.click ?? step.uncheck), '->', what, `(${Math.round(performance.now() - t0)} ms)`);
    };
    if (step.wait) {
      const el = await waitFor(() => { const r = stepRoot(rule, step); return r && find(r, step.wait); }, timeout);
      if (__DEBUG__) log(el ? 'found' : step.optional ? 'absent (optional)' : 'TIMEOUT');
      if (!el && !step.optional) return false;
    } else if (step.click) {
      const el = await waitFor(() => { const r = stepRoot(rule, step); return r && find(r, step.click, step.text, step.hidden); }, timeout);
      if (!el) {
        if (__DEBUG__) log(step.optional ? 'absent (optional)' : 'TIMEOUT');
        if (step.optional) continue;
        return false;
      }
      if (!safeToClick(el, !!step.save && verified)) {
        if (__DEBUG__) log('REFUSED by safety gate');
        return false;
      }
      timed(() => click(el));
      if (__DEBUG__) log(step.done ? 'clicked, flow done' : 'clicked');
      if (step.done) return true;
      await sleep(150);
    } else if (step.uncheck) {
      const sel = step.uncheck;
      const r = stepRoot(rule, step);
      const ok = !!r && timed(() => uncheckAll(r, sel));
      if (__DEBUG__) log(ok ? 'all off (verified)' : r ? 'FAILED: a toggle stayed on' : 'FAILED: shadow host missing');
      if (!ok) return false;
      verified = true;
      await sleep(100);
    }
  }
  return true;
}

const bannerEl = (rule: Rule): HTMLElement | null => find(rule.visible ? scope(rule) : document, rule.visible ?? rule.detect);
const bannerVisible = (rule: Rule): boolean => !!bannerEl(rule);

function hideRule(rule: Rule): void {
  if (rule.hide) document.querySelectorAll(rule.hide).forEach(hide);
  restoreScroll(rule.hideClasses);
}

const CMP_HINT = /cookie|consent|cmp|truste|onetrust|didomi|cmplz|qc-cmp|sp_message|axeptio|iubenda|usercentrics|cybot/i;
const hint = (e: Element): string => `${e.id} ${e.getAttribute('class') ?? ''}`;

/** A visible dialog that is not part of a CMP (a site's own country picker, login...). */
function siteDialogOpen(): boolean {
  for (const d of document.querySelectorAll('[role=dialog],[aria-modal=true],dialog[open]')) {
    if (!isVisible(d)) continue;
    let cmp = false;
    for (let e: Element | null = d; e && !cmp; e = e.parentElement) cmp = CMP_HINT.test(hint(e));
    if (!cmp) return true;
  }
  return false;
}

/**
 * Final "page usable" check, run after every rule outcome: oho must never leave the page
 * blocked. Clears the CMP's leftover overlays/backdrops (live finding: TrustArc on redhat.com
 * keeps a full-screen .truste_cm_outerdiv after the refusal is saved) and a scroll lock,
 * unless a non-CMP dialog explains the lock.
 */
export function makeUsable(rule: Rule): void {
  if (rule.frame) return;
  if (rule.overlay) document.querySelectorAll(rule.overlay).forEach((e) => isVisible(e) && hide(e));
  const vw = innerWidth, vh = innerHeight;
  for (const e of document.body?.children ?? []) {
    // Cheapest test first: innerText needs layout, so it is read only for a large fixed CMP layer.
    if (!CMP_HINT.test(hint(e)) || !isVisible(e) || getComputedStyle(e).position !== 'fixed') continue;
    const r = e.getBoundingClientRect();
    if (r.width * r.height > vw * vh * 0.6 && ((e as HTMLElement).innerText ?? '').trim().length < 30) hide(e);
  }
  const html = document.documentElement, body = document.body;
  const locked = [html, body].some((e) => e && getComputedStyle(e).overflowY === 'hidden') ||
    (!!body && getComputedStyle(body).position === 'fixed');
  if (locked && !siteDialogOpen()) restoreScroll(rule.hideClasses);
  else if (rule.hideClasses) restoreScroll(rule.hideClasses);
}

/** How long the CMP gets to close its banner after we act, before we try again. */
const CONFIRM_MS = 1500;

/**
 * Did the CMP close its banner? Polls until it is gone or `ms` passed. This is what turns
 * "we clicked" into "the CMP accepted the click": live sites (OneTrust, Iubenda) often render
 * the reject button before wiring its handler, so an early click is silently ignored.
 */
async function closed(rule: Rule, ms = CONFIRM_MS): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (!timed(() => bannerVisible(rule))) return true;
    if (Date.now() >= end) return false;
    await sleep(150);
  }
}

/**
 * The rule's reject button, or 'refused' when the curated button is there but the safety gate
 * refuses its label ("Rifiuta e abbonati" on repubblica.it). A refused label doesn't become free
 * by polling it again, so callers stop waiting.
 */
function findReject(rule: Rule): HTMLElement | 'refused' | null {
  const b = find(scope(rule), rule.reject, rule.rejectText ? 'reject' : undefined);
  return b ? (safeToClick(b) ? b : 'refused') : null;
}

/**
 * Pre-split detect selectors so the common "nothing here" case costs O(1) lookups:
 * `#id` -> getElementById, `.class` -> getElementsByClassName, `body > x` -> scan body's children,
 * and only the rest goes into ONE combined querySelector (a single native tree walk).
 */
function compileDetect(rules: Rule[]): (added?: readonly Element[]) => boolean {
  const ids: string[] = [];
  const classes: string[] = [];
  const kids: string[] = [];
  const rest: string[] = [];
  for (const r of rules) {
    for (const s of r.detect.split(',').map((x) => x.trim())) {
      if (s.startsWith('body > ')) kids.push(s.slice(7));
      else if (/^#[\w-]+$/.test(s)) ids.push(s.slice(1));
      else if (/^\.[\w-]+$/.test(s)) classes.push(s.slice(1));
      else rest.push(s);
    }
  }
  const combined = rest.join(',');
  const kid = kids.join(',');
  const nonId = [...classes.map((c) => '.' + c), ...rest, ...kids].join(',');
  return (added) => {
    if (ids.some((id) => document.getElementById(id))) return true;
    // Incremental: live class collections are invalidated by every mutation (each .length would
    // re-walk the DOM), so only the newly added subtrees are matched.
    if (added) return !!nonId && added.some((e) => e.isConnected && (e.matches(nonId) || !!e.querySelector(nonId)));
    return (
      classes.some((c) => document.getElementsByClassName(c).length > 0) ||
      (!!kid && [...(document.body?.children ?? [])].some((e) => e.matches(kid))) ||
      (!!combined && !!document.querySelector(combined))
    );
  };
}

export class RuleEngine {
  private readonly present: (added?: readonly Element[]) => boolean;
  private readonly failed = new Set<string>();

  constructor(private readonly rules: Rule[]) {
    this.present = compileDetect(rules);
  }

  /** Fast path: cheap presence check for all CMPs at once, then identify which one. */
  detect(added?: readonly Element[]): { rule: Rule; visible: boolean } | null {
    if (!this.rules.length || !this.present(added)) return null;
    for (const rule of this.rules) {
      if (this.failed.has(rule.id) || !document.querySelector(rule.detect)) continue;
      return { rule, visible: bannerVisible(rule) };
    }
    return null;
  }

  async handle(rule: Rule, opts: HandleOptions): Promise<Outcome> {
    const out = await this.tryReject(rule, opts);
    if (!out) this.failed.add(rule.id);
    return out;
  }

  private async tryReject(rule: Rule, opts: HandleOptions): Promise<Outcome> {
    // Inside a CMP frame, a pay-or-accept wall is reported (the top frame decides) and the
    // frame does nothing else: no wandering into settings on a wall.
    // The message's buttons fade in after it becomes visible (bild.de): wait until it is
    // clearly a wall or a reject button shows up, before taking any path.
    if (rule.frame) {
      const v = await waitFor(() => {
        if (isWall(scope(rule))) return 'wall';
        const b = findReject(rule);
        return b && b !== 'refused' ? 'reject' : null;
      }, 2000);
      if (__DEBUG__) dbg('frame check', rule.id, v ?? 'undecided after 2 s');
      if (v === 'wall') return 'wall';
    }
    if (__DEBUG__) dbg('rule chosen', rule.id, `paths: ${[rule.reject && 'reject', rule.api && 'api', rule.flow && 'flow', rule.hide && 'hide'].filter(Boolean).join(',')}`);

    // Inside a CMP iframe the frame is usually destroyed right after the click, so we can't
    // wait to see it close: report immediately. In the top frame, every action is confirmed.
    const done = (): Promise<boolean> => (rule.frame ? Promise.resolve(true) : closed(rule));
    const ok = (): Outcome => {
      // Give the CMP a moment to tear down its own overlay, then make sure the page is usable.
      setTimeout(() => timed(() => makeUsable(rule), 'usable'), 1200);
      return 'rejected';
    };

    // 1. One-click reject, retried once: the first click may land before the handler exists.
    for (let i = 0; i < 2; i++) {
      // The banner can be "visible" while its buttons are still fading in (Axeptio on
      // ornikar.com): give the reject button a moment to appear before falling back.
      const btn = rule.reject ? await waitFor(() => findReject(rule), i === 0 ? CONFIRM_MS : 0) : null;
      if (__DEBUG__) dbg('reject', rule.id, `attempt ${i + 1}:`, btn === 'refused' ? 'button refused by the safety gate' : btn ? 'button found' : 'no button');
      if (!btn || btn === 'refused') break;
      timed(() => click(btn));
      const shut = await done();
      if (__DEBUG__) dbg('reject', rule.id, `attempt ${i + 1}:`, rule.frame ? 'clicked (in frame: not awaited)' : shut ? 'banner closed' : `banner still open after ${CONFIRM_MS} ms`);
      if (shut) return ok();
    }
    // 2. The CMP's own reject API. If it returns, the CMP has recorded the refusal itself,
    //    so a banner that stays open is only cosmetic: hide it.
    const api = !!rule.api && timed(() => callApi(rule.api!));
    if (__DEBUG__ && rule.api) dbg('api', rule.id, rule.api, api ? 'returned ok' : 'unavailable or failed');
    if (api) {
      if (!(await done())) timed(() => hideRule(rule));
      return ok();
    }
    // 3. Multi-step flow (preferences -> switch everything off -> verify -> save).
    const flowed = !!rule.flow && (await runFlow(rule));
    if (__DEBUG__ && rule.flow) dbg('flow', rule.id, flowed ? 'completed' : 'aborted');
    if (flowed) {
      if (!(await done())) timed(() => hideRule(rule));
      return ok();
    }
    if (rule.hide) {
      if (rule.hideDelay) await sleep(rule.hideDelay);
      const el = timed(() => (document.querySelector(rule.detect) ? bannerEl(rule) : null));
      if (!el) {
        if (__DEBUG__) dbg('hide path', rule.id, 'banner gone before hiding');
        return null;
      }
      // Pay-or-accept wall: the only refusal is paying. Left alone unless the user opted in.
      let wall = timed(() => isWall(el));
      // The banner lives in a cross-origin CMP frame that oho also runs in: while the container is
      // still up and no frame has reported, the frame is still working (a wall check, a slow
      // second layer). Wait for it rather than hiding the banner it is about to refuse.
      for (let i = 0; !wall && rule.wallInFrame && i < FRAME_POLLS; i++) {
        const f = await opts.frameOutcome();
        if (__DEBUG__ && (f || i === 0 || i === FRAME_POLLS - 1)) dbg('hide path', rule.id, `poll ${i + 1}/${FRAME_POLLS}: frame reported`, f ?? 'nothing yet');
        if (f === 'wall') wall = true;
        else if (f) {
          // The frame refused (or hid) and reported it: only make sure nothing is left blocking.
          timed(() => makeUsable(rule));
          return 'frame';
        } else if (!timed(() => bannerVisible(rule))) {
          if (__DEBUG__) dbg('hide path', rule.id, 'container gone, no frame report');
          return null;
        } else await sleep(500);
      }
      if (__DEBUG__) dbg('hide path', rule.id, 'wall=' + wall, 'hideWalls=' + opts.hideWalls);
      if (wall && !opts.hideWalls) return 'wall';
      return timed(() => {
        hideRule(rule);
        makeUsable(rule);
        return 'hidden' as const;
      });
    }
    if (__DEBUG__) dbg('rule failed', rule.id, 'every path exhausted');
    return null;
  }
}
