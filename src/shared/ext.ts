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
  /** Hide pay-or-accept walls (no free way to refuse). Off by default: oho leaves them alone. */
  hideWalls: boolean;
}
export interface Stats {
  total: number;
}

export const DEFAULT_SETTINGS: Settings = { enabled: true, disabledSites: [], hideWalls: false };

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

/** 'wall': a pay-or-accept wall oho deliberately left alone (not counted as handled). */
export type How = 'rejected' | 'hidden' | 'wall';
export interface Last {
  id: string;
  how: How;
  t: number;
}

export type Msg =
  | { type: 'oho_done'; id: string; how: How }
  | { type: 'oho_check' }
  /** Top frame asks for this tab's last outcome (a CMP iframe may have reported a wall). */
  | { type: 'oho_last' };
