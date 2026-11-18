import { SETTINGS_KEY, STATS_KEY, ext, getSettings, siteOf, tabKey, type Settings, type Stats } from '../shared/ext';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ORIGINS = { origins: ['http://*/*', 'https://*/*'] };

/**
 * Firefox treats MV3 host permissions as revocable (and on older versions, opt-in), so the
 * content scripts may not be allowed to run. Show a one-click prompt when that is the case.
 */
async function checkAccess(): Promise<void> {
  const box = $('grant');
  const has = await ext.permissions.contains(ORIGINS).catch(() => true);
  box.hidden = has;
  if (has) return;
  $('grant-btn').addEventListener('click', async () => {
    // permissions.request must be called directly from the click handler (user gesture).
    if (await ext.permissions.request(ORIGINS).catch(() => false)) box.hidden = true;
  });
}

async function init(): Promise<void> {
  void checkAccess();
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  let site = '';
  try {
    const u = new URL(tab?.url ?? '');
    if (/^https?:$/.test(u.protocol)) site = siteOf(u.hostname);
  } catch {
    /* non-web page */
  }

  let settings: Settings = await getSettings();
  const local = await ext.storage.local.get(STATS_KEY);
  const total = (local[STATS_KEY] as Stats | undefined)?.total ?? 0;
  let onTab = 0;
  if (tab?.id !== undefined) {
    const s = await ext.storage.session.get(tabKey(tab.id));
    onTab = (s[tabKey(tab.id)] as number | undefined) ?? 0;
  }

  const enabled = $<HTMLInputElement>('enabled');
  const siteBox = $<HTMLInputElement>('site');
  $('site-name').textContent = site || 'this page';
  $('tab-count').textContent = String(onTab);
  $('total-count').textContent = String(total);
  enabled.checked = settings.enabled;
  siteBox.checked = !!site && settings.disabledSites.includes(site);
  siteBox.disabled = !site || !settings.enabled;

  const save = async (next: Settings): Promise<void> => {
    settings = next;
    await ext.storage.local.set({ [SETTINGS_KEY]: next });
    siteBox.disabled = !site || !next.enabled;
    $('hint').hidden = false;
  };

  enabled.addEventListener('change', () => void save({ ...settings, enabled: enabled.checked }));
  siteBox.addEventListener('change', () => {
    const rest = settings.disabledSites.filter((d) => d !== site);
    void save({ ...settings, disabledSites: siteBox.checked ? [...rest, site] : rest });
  });
}

void init();
