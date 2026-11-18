/** `browser` on Firefox, `chrome` on Chromium. Both return Promises in MV3. */
export const ext: typeof chrome =
  (globalThis as unknown as { browser?: typeof chrome }).browser ?? globalThis.chrome;

export const SETTINGS_KEY = 'oho_settings';
export const STATS_KEY = 'oho_stats';
export const tabKey = (id: number): string => `oho_tab_${id}`;
export const lastKey = (id: number): string => `oho_last_${id}`;

export interface Settings {
  enabled: boolean;
  disabledSites: string[];
}
export interface Stats {
  total: number;
}

export const DEFAULT_SETTINGS: Settings = { enabled: true, disabledSites: [] };

export async function getSettings(): Promise<Settings> {
  try {
    const r = await ext.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(r[SETTINGS_KEY] as Partial<Settings> | undefined) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Normalised host used for the per-site allowlist ("www." is ignored). */
export const siteOf = (host: string): string => host.replace(/^www\./, '');

export function isAllowed(s: Settings, host: string): boolean {
  if (!s.enabled) return false;
  const h = siteOf(host);
  return !s.disabledSites.some((d) => h === d || h.endsWith('.' + d));
}

export type Msg =
  | { type: 'oho_done'; id: string; how: 'rejected' | 'hidden' }
  | { type: 'oho_check' };
