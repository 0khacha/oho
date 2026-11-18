/**
 * DEV ONLY - never shipped in the extension. Built to training/collector.js by
 * `npm run build:collector`, then used as a bookmarklet or pasted into DevTools.
 *
 * For every candidate on the page it outlines the element, asks "Is this a cookie banner?",
 * and appends a CSV row (features + label) to localStorage['oho_dataset'].
 * Call `ohoCollector.download()` to save all rows as oho-dataset.csv.
 * Automated mode (used by tests/dump-features.mjs): set window.__ohoAutoLabel = (el) => 0|1
 */
import { findCandidates } from './candidates';
import { FEATURES, extract } from './features';
import { score } from './model';

const KEY = 'oho_dataset';
const header = [...FEATURES, 'label', 'url'].join(',');

type W = Window & {
  __ohoAutoLabel?: (el: Element) => number;
  __ohoRows?: string[];
  ohoCollector?: { download(): void; clear(): void; rows(): string[] };
};
const w = window as W;

const load = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};
const store = (rows: string[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* storage blocked */
  }
};

function collect(): string[] {
  const rows: string[] = [];
  const url = location.href.replace(/[",\n]/g, ' ');
  for (const c of findCandidates(new WeakSet())) {
    const f = extract(c);
    let label: number;
    if (w.__ohoAutoLabel) {
      label = w.__ohoAutoLabel(c.el);
    } else {
      const prev = c.el.style.outline;
      c.el.style.outline = '4px solid #c2410c';
      const p = score(f).toFixed(2);
      label = confirm(`oho collector (model p=${p})\n\nIs the outlined element a cookie/consent banner?\nOK = yes, Cancel = no`) ? 1 : 0;
      c.el.style.outline = prev;
    }
    rows.push([...FEATURES.map((k) => +f[k].toFixed(4)), label, `"${url}"`].join(','));
  }
  return rows;
}

const rows = collect();
w.__ohoRows = rows;
store([...load(), ...rows]);
w.ohoCollector = {
  rows: () => [header, ...load()],
  clear: () => store([]),
  download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[header, ...load()].join('\n') + '\n'], { type: 'text/csv' }));
    a.download = 'oho-dataset.csv';
    a.click();
  },
};
console.log(`[oho collector] ${rows.length} candidate(s) recorded, ${load().length} total. ohoCollector.download() to export.`);
