import data from '../rules/cmps.json';
import { RE, type Category } from './shared/keywords';
import { MARK, click, hide, isVisible, labelOf, restoreScroll, safeToClick, sleep, timed } from './shared/dom';

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
  frame?: string[];
  /** Also run in iframes whose URL contains this string (first-party CNAME CMP frames). */
  frameUrl?: string;
}

export type Outcome = 'rejected' | 'hidden' | null;

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
    const v = timed(fn);
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

async function runFlow(rule: Rule): Promise<boolean> {
  let verified = false;
  for (const step of rule.flow ?? []) {
    const timeout = step.timeout ?? (step.optional ? 600 : 2000);
    if (step.wait) {
      const el = await waitFor(() => find(scope(rule), step.wait), timeout);
      if (!el && !step.optional) return false;
    } else if (step.click) {
      const el = await waitFor(() => find(scope(rule), step.click, step.text, step.hidden), timeout);
      if (!el) {
        if (step.optional) continue;
        return false;
      }
      if (!safeToClick(el, !!step.save && verified)) return false;
      timed(() => click(el));
      if (step.done) return true;
      await sleep(150);
    } else if (step.uncheck) {
      const sel = step.uncheck;
      if (!timed(() => uncheckAll(scope(rule), sel))) return false;
      verified = true;
      await sleep(100);
    }
  }
  return true;
}

const bannerVisible = (rule: Rule): boolean =>
  !!find(rule.visible ? scope(rule) : document, rule.visible ?? rule.detect);

function hideRule(rule: Rule): void {
  if (rule.hide) document.querySelectorAll(rule.hide).forEach(hide);
  restoreScroll(rule.hideClasses);
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

function findReject(rule: Rule): HTMLElement | null {
  const b = find(scope(rule), rule.reject, rule.rejectText ? 'reject' : undefined);
  return b && safeToClick(b) ? b : null;
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

  async handle(rule: Rule): Promise<Outcome> {
    const out = await this.tryReject(rule);
    if (!out) this.failed.add(rule.id);
    return out;
  }

  private async tryReject(rule: Rule): Promise<Outcome> {
    // Inside a CMP iframe the frame is usually destroyed right after the click, so we can't
    // wait to see it close: report immediately. In the top frame, every action is confirmed.
    const done = (): Promise<boolean> => (rule.frame ? Promise.resolve(true) : closed(rule));
    const ok = (): Outcome => {
      if (rule.hideClasses) timed(() => restoreScroll(rule.hideClasses));
      return 'rejected';
    };

    // 1. One-click reject, retried once: the first click may land before the handler exists.
    for (let i = 0; i < 2; i++) {
      // The banner can be "visible" while its buttons are still fading in (Axeptio on
      // ornikar.com): give the reject button a moment to appear before falling back.
      const btn = rule.reject ? await waitFor(() => findReject(rule), i === 0 ? CONFIRM_MS : 0) : null;
      if (!btn) break;
      timed(() => click(btn));
      if (await done()) return ok();
    }
    // 2. The CMP's own reject API. If it returns, the CMP has recorded the refusal itself,
    //    so a banner that stays open is only cosmetic: hide it.
    if (rule.api && timed(() => callApi(rule.api!))) {
      if (!(await done())) timed(() => hideRule(rule));
      return ok();
    }
    // 3. Multi-step flow (preferences -> switch everything off -> verify -> save).
    if (rule.flow && (await runFlow(rule))) {
      if (!(await done())) timed(() => hideRule(rule));
      return ok();
    }
    if (rule.hide) {
      if (rule.hideDelay) await sleep(rule.hideDelay);
      return timed(() => {
        if (!document.querySelector(rule.detect) || !bannerVisible(rule)) return null;
        hideRule(rule);
        return 'hidden' as const;
      });
    }
    return null;
  }
}
