import kw from '../../rules/keywords.json';

export type Category = 'banner' | 'reject' | 'accept' | 'settings' | 'save' | 'pay';

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Word characters for our boundaries: digits, Latin (incl. accents) and Arabic (incl. diacritics).
 * Text is lowercased first. An explicit class compiles ~10x faster than \p{L}\p{M}\p{N} with /u.
 */
const WORD = '[0-9a-z\\u00c0-\\u024f\\u0600-\\u06ff]';

/** One combined RegExp per category, with word boundaries that also work for Arabic. */
function compile(words: string[], prefix = false, flags = ''): RegExp {
  const alt = [...words].sort((a, b) => b.length - a.length).map(esc).join('|');
  const b = WORD;
  return new RegExp(`(?<!${b})(?:${alt})${prefix ? '' : `(?!${b})`}`, flags);
}

const cache: Partial<Record<Category | 'bannerG', RegExp>> = {};
const lazy = (k: Category | 'bannerG', make: () => RegExp): RegExp => (cache[k] ??= make());

/**
 * Compiled once, on first use: a page with no banner candidates never pays for
 * building these (compilation is the expensive part).
 */
export const RE = {
  get banner() { return lazy('banner', () => compile(kw.banner, true)); },
  get reject() { return lazy('reject', () => compile(kw.reject)); },
  get accept() { return lazy('accept', () => compile(kw.accept)); },
  get settings() { return lazy('settings', () => compile(kw.settings)); },
  get save() { return lazy('save', () => compile(kw.save)); },
  get pay() { return lazy('pay', () => compile(kw.pay)); },
} satisfies Record<Category, RegExp>;

/** Prices ("3,99 €", "€2.99", "$5") mark a paid option on pay-or-accept walls. */
export const PRICE = /[€£$]|\d+[.,]\d{2}\b/;

/** Global variant used for counting keyword hits. */
export const bannerG = (): RegExp => lazy('bannerG', () => compile(kw.banner, true, 'g'));

export const norm = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
